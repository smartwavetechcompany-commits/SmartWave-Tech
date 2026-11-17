import assert from 'node:assert/strict';
import {
  escapeHtml,
  sanitizeEmailHeaderValue,
  isValidEmailAddress,
  isSafeIdentifier,
  isAllowedOrigin,
  resolveSafeAppOrigin,
  isSafeActionUrl,
  sanitizeErrorForClient,
  redactSensitiveUserFields,
  BoundedRateLimiter,
  isSuperAdminCaller,
  isAccountSuspendedOrPending,
  callerBelongsToHotel,
  callerHasStaffManagement,
  callerIsHotelStaff,
} from './src/utils/serverSecurity.ts';
import { escapeCsvCell } from './src/utils.ts';
import { hasPermission, SYSTEM_ROLE_TEMPLATES, BASE_ROLE_PERMISSIONS } from './src/utils/permissions.ts';
import {
  RESTAURANT_POSTING_BLOCKED_MESSAGE,
  buildRoomRestaurantPostingUpdate,
  canManageRoomRestaurantPosting,
  findTargetRoomForOrder,
  isRestaurantCategory,
  isRoomRestaurantPostingBlocked,
} from './src/utils/restaurantPostingGuard.ts';
import type { Room } from './src/types.ts';

function runSecurityTests() {
  console.log('Running Security Hardening & Regression Test Suite...');

  // 1. HTML Escaping (Email / Stored XSS prevention)
  assert.equal(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(escapeHtml('" onerror="alert`1`"'), '&quot; onerror=&quot;alert&#96;1&#96;&quot;');
  assert.equal(escapeHtml("O'Reilly & Co"), "O&#39;Reilly &amp; Co");
  assert.equal(escapeHtml(null), '');

  // 2. SMTP Header Injection Prevention
  assert.equal(
    sanitizeEmailHeaderValue('Hotel\r\nBcc: attacker@evil.com\nSubject: Hacked'),
    'Hotel Bcc: attacker@evil.com Subject: Hacked'
  );
  assert.equal(sanitizeEmailHeaderValue('"\r\n', 'Fallback'), 'Fallback');

  // 3. Input Validation (Email & Safe Identifiers)
  assert.equal(isValidEmailAddress('staff@hotel.com'), true);
  assert.equal(isValidEmailAddress('bad\r\n@hotel.com'), false);
  assert.equal(isValidEmailAddress('not-an-email'), false);

  assert.equal(isSafeIdentifier('hotel_123-abc.def'), true);
  assert.equal(isSafeIdentifier('../etc/passwd'), false);
  assert.equal(isSafeIdentifier('hotel/other'), false);
  assert.equal(isSafeIdentifier(''), false);

  // 4. CORS Origin Validation
  assert.equal(isAllowedOrigin(undefined, 'localhost:3000'), true);
  assert.equal(isAllowedOrigin('http://localhost:3000', 'localhost:3000'), true);
  assert.equal(isAllowedOrigin('https://ais-dev-5kgc7z42bdzj2egpcsdgjt-229811512615.europe-west2.run.app', 'localhost:3000'), true);
  assert.equal(isAllowedOrigin('https://smartwave-pi.vercel.app', 'localhost:3000'), true);
  assert.equal(isAllowedOrigin('https://evil-attacker.example', 'localhost:3000'), false);
  assert.equal(isAllowedOrigin('http://evil-run-app.example', 'localhost:3000'), false);
  assert.equal(isAllowedOrigin('javascript:alert(1)', 'localhost:3000'), false);

  // 5. Open Redirect / Poisoned baseUrl Prevention
  assert.equal(
    resolveSafeAppOrigin('https://phishing.evil.com', 'localhost:3000', 'http://localhost:3000', undefined, 3000),
    'http://localhost:3000'
  );
  assert.equal(
    resolveSafeAppOrigin('javascript:alert(1)', 'localhost:3000', undefined, 'https://app.example.com', 3000),
    'https://app.example.com'
  );
  assert.equal(
    resolveSafeAppOrigin('https://smartwave-pi.vercel.app/ignored-path', 'localhost:3000', undefined, undefined, 3000),
    'https://smartwave-pi.vercel.app'
  );

  // 6. Action URL Validation
  assert.equal(
    isSafeActionUrl('https://smartwave-pi.vercel.app/set-password?token=act_123', 'localhost:3000'),
    true
  );
  assert.equal(
    isSafeActionUrl('https://smartwave-pi.vercel.app/?resetToken=prt_123', 'localhost:3000'),
    true
  );
  assert.equal(
    isSafeActionUrl('https://evil.example/set-password?token=act_123', 'localhost:3000'),
    false
  );
  assert.equal(
    isSafeActionUrl('javascript:alert(1)', 'localhost:3000'),
    false
  );

  // 7. Error & Credential Redaction
  assert.equal(
    sanitizeErrorForClient(new Error('SQL/Firestore internals at /app/server.ts:42'), 'Request failed.'),
    'Request failed.'
  );
  const redacted = redactSensitiveUserFields({
    uid: 'u1',
    email: 'a@b.com',
    initialTempPass: 'secret1',
    systemAuthSecret: 'secret2',
    temporaryPassword: 'secret3',
    initialPassword: 'secret4',
    tempPass: 'secret5',
  });
  assert.equal(redacted.uid, 'u1');
  assert.equal('initialTempPass' in redacted, false);
  assert.equal('systemAuthSecret' in redacted, false);
  assert.equal('temporaryPassword' in redacted, false);
  assert.equal('initialPassword' in redacted, false);
  assert.equal('tempPass' in redacted, false);

  // 8. Bounded Rate Limiter (throttling & memory cap)
  const limiter = new BoundedRateLimiter(5);
  for (let i = 0; i < 3; i++) {
    assert.equal(limiter.check('1.2.3.4:/api/auth/validate-token', 3, 60000, 1000).allowed, true);
  }
  const blocked = limiter.check('1.2.3.4:/api/auth/validate-token', 3, 60000, 1000);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterMs > 0);
  // Window expiry allows again
  assert.equal(limiter.check('1.2.3.4:/api/auth/validate-token', 3, 60000, 62000).allowed, true);
  // Bounded max entries
  for (let i = 0; i < 20; i++) {
    limiter.check(`ip-${i}:/api/test`, 5, 60000, 62000);
  }
  assert.ok(limiter.size <= 5);

  // 9. RBAC & Multi-Tenant Authorization Checks
  const superAdmin = { email: 'smartwavetechcompany@gmail.com', profile: { role: 'superAdmin', status: 'active' } };
  const hotelAdminA = { email: 'adminA@hotel.com', profile: { role: 'hotelAdmin', hotelId: 'hotel_A', status: 'active' } };
  const staffA = { email: 'deskA@hotel.com', profile: { role: 'staff', staffRole: 'frontDesk', hotelId: 'hotel_A', status: 'active', permissions: ['view_ledger'] } };
  const suspendedAdmin = { email: 'sus@hotel.com', profile: { role: 'hotelAdmin', hotelId: 'hotel_A', status: 'suspended' } };
  const pendingAdmin = { email: 'pend@hotel.com', profile: { role: 'hotelAdmin', hotelId: 'hotel_A', status: 'pending_activation' } };

  assert.equal(isSuperAdminCaller(superAdmin), true);
  assert.equal(isSuperAdminCaller(hotelAdminA), false);
  assert.equal(isAccountSuspendedOrPending(suspendedAdmin.profile), true);
  assert.equal(isAccountSuspendedOrPending(pendingAdmin.profile), true);
  assert.equal(callerBelongsToHotel(hotelAdminA, 'hotel_A'), true);
  assert.equal(callerBelongsToHotel(hotelAdminA, 'hotel_B'), false);
  assert.equal(callerBelongsToHotel(suspendedAdmin, 'hotel_A'), false);
  assert.equal(callerHasStaffManagement(hotelAdminA, 'hotel_A'), true);
  assert.equal(callerHasStaffManagement(hotelAdminA, 'hotel_B'), false);
  assert.equal(callerHasStaffManagement(staffA, 'hotel_A'), false);
  assert.equal(callerIsHotelStaff(staffA, 'hotel_A'), true);
  assert.equal(callerIsHotelStaff(staffA, 'hotel_B'), false);

  // 10. CSV Formula Injection Protection (while preserving legitimate numbers!)
  assert.equal(escapeCsvCell('=CMD("calc")'), '"\'=CMD(""calc"")"');
  assert.equal(escapeCsvCell('+SUM(A1:A2)'), '"\'+SUM(A1:A2)"');
  assert.equal(escapeCsvCell('-cmd|calc'), '"\'-cmd|calc"');
  assert.equal(escapeCsvCell('@SUM(1,2)'), '"\'@SUM(1,2)"');
  assert.equal(escapeCsvCell('\t=1+1'), '"\'\t=1+1"');
  // Legitimate negative balance must NOT be corrupted with apostrophe prefix
  assert.equal(escapeCsvCell(-5000), '"-5000"');
  assert.equal(escapeCsvCell('-12500.50'), '"-12500.50"');
  assert.equal(escapeCsvCell('John Doe, Corp'), '"John Doe, Corp"');

  // 11. Room-Level Restaurant Posting Restriction & RBAC Enforcement
  // 11a. Must NOT be auto-granted to standard Front Desk or Kitchen roles
  assert.equal(SYSTEM_ROLE_TEMPLATES.frontDeskAgent.permissions.includes('block_restaurant_posting'), false);
  assert.equal(SYSTEM_ROLE_TEMPLATES.frontDeskSupervisor.permissions.includes('block_restaurant_posting'), false);
  assert.equal(BASE_ROLE_PERMISSIONS.frontDesk.includes('block_restaurant_posting'), false);
  assert.equal(BASE_ROLE_PERMISSIONS.receptionist.includes('block_restaurant_posting'), false);
  assert.equal(BASE_ROLE_PERMISSIONS.kitchen.includes('block_restaurant_posting'), false);

  const frontDeskNoPerm = {
    uid: 'fd_1',
    role: 'staff',
    staffRole: 'frontDesk',
    hotelId: 'hotel_A',
    status: 'active',
    permissions: ['view_reservations', 'check_in_guests', 'check_out_guests', 'view_rooms'],
  };
  const frontDeskLegacyNoPerm = {
    uid: 'fd_2',
    role: 'frontDesk',
    hotelId: 'hotel_A',
    status: 'active',
  };
  const frontDeskWithPerm = {
    uid: 'fd_3',
    displayName: 'Grace FrontDesk',
    email: 'grace@hotel.com',
    role: 'staff',
    staffRole: 'frontDesk',
    hotelId: 'hotel_A',
    status: 'active',
    permissions: ['view_reservations', 'block_restaurant_posting'],
  };
  const customRoles = [
    {
      id: 'role_fd_restricted',
      status: 'active',
      permissions: ['view_reservations', 'check_in_guests'],
    },
    {
      id: 'role_fd_allowed',
      status: 'active',
      permissions: ['view_reservations', 'block_restaurant_posting'],
    },
  ];
  const staffCustomRestricted = {
    uid: 'fd_4',
    role: 'staff',
    customRoleId: 'role_fd_restricted',
    hotelId: 'hotel_A',
    status: 'active',
  };
  const staffCustomAllowed = {
    uid: 'fd_5',
    displayName: 'Supervisor Ada',
    email: 'ada@hotel.com',
    role: 'staff',
    customRoleId: 'role_fd_allowed',
    hotelId: 'hotel_A',
    status: 'active',
  };

  assert.equal(canManageRoomRestaurantPosting(frontDeskNoPerm, customRoles), false);
  assert.equal(canManageRoomRestaurantPosting(frontDeskLegacyNoPerm, customRoles), false);
  assert.equal(canManageRoomRestaurantPosting(staffCustomRestricted, customRoles), false);
  assert.equal(canManageRoomRestaurantPosting(frontDeskWithPerm, customRoles), true);
  assert.equal(canManageRoomRestaurantPosting(staffCustomAllowed, customRoles), true);
  assert.equal(hasPermission(hotelAdminA.profile, 'block_restaurant_posting', customRoles), true);
  assert.equal(hasPermission(superAdmin.profile, 'block_restaurant_posting', customRoles), true);

  let room101: Room = {
    id: 'room_101',
    roomNumber: '101',
    type: 'Standard',
    price: 50000,
    status: 'occupied',
    floor: '1',
    capacity: 2,
  };
  const room102: Room = {
    id: 'room_102',
    roomNumber: '102',
    type: 'Standard',
    price: 50000,
    status: 'occupied',
    floor: '1',
    capacity: 2,
  };

  // Unauthorized user attempting direct restriction update must be rejected
  assert.throws(() => {
    buildRoomRestaurantPostingUpdate({
      room: room101,
      block: true,
      reason: 'Unauthorized try',
      profile: frontDeskNoPerm,
      customRoles,
    });
  }, /Unauthorized/);

  // Empty reason must be rejected
  assert.throws(() => {
    buildRoomRestaurantPostingUpdate({
      room: room101,
      block: true,
      reason: '   ',
      profile: frontDeskWithPerm,
      customRoles,
    });
  }, /reason is required/i);

  // Authorized user blocks Room 101 with reason + audit metadata
  const blockUpdate = buildRoomRestaurantPostingUpdate({
    room: room101,
    block: true,
    reason: 'Guest requested no restaurant room charges',
    profile: frontDeskWithPerm,
    customRoles,
    nowISO: '2026-11-17T10:00:00.000Z',
  });
  room101 = { ...room101, ...blockUpdate };

  assert.equal(isRoomRestaurantPostingBlocked(room101), true);
  assert.equal(isRoomRestaurantPostingBlocked(room102), false); // Room 102 stays unaffected
  assert.equal(room101.restaurantPostingRestriction?.updatedByUid, 'fd_3');
  assert.equal(room101.restaurantPostingRestriction?.updatedByName, 'Grace FrontDesk');
  assert.equal(room101.restaurantPostingRestriction?.updatedAt, '2026-11-17T10:00:00.000Z');
  assert.equal(room101.restaurantPostingRestriction?.reason, 'Guest requested no restaurant room charges');
  assert.equal(room101.restaurantPostingHistory?.length, 1);

  // Restaurant target lookup & category enforcement checks
  const found101 = findTargetRoomForOrder([room101, room102], { roomNumber: '101' });
  const found102 = findTargetRoomForOrder([room101, room102], { roomNumber: '102' });
  assert.equal(isRoomRestaurantPostingBlocked(found101), true);
  assert.equal(isRoomRestaurantPostingBlocked(found102), false);
  assert.equal(RESTAURANT_POSTING_BLOCKED_MESSAGE, 'Restaurant posting is blocked for this room. Please contact Front Desk.');
  assert.equal(isRestaurantCategory('F & B'), true);
  assert.equal(isRestaurantCategory('restaurant'), true);
  assert.equal(isRestaurantCategory('room'), false);
  assert.equal(isRestaurantCategory('payment'), false);

  // Authorized custom-role user unblocks Room 101; history & posting resume cleanly
  const unblockUpdate = buildRoomRestaurantPostingUpdate({
    room: room101,
    block: false,
    reason: 'Deposit topped up at Front Desk',
    profile: staffCustomAllowed,
    customRoles,
    nowISO: '2026-11-17T12:30:00.000Z',
  });
  room101 = { ...room101, ...unblockUpdate };
  assert.equal(isRoomRestaurantPostingBlocked(room101), false);
  assert.equal(room101.restaurantPostingRestriction?.action, 'unblocked');
  assert.equal(room101.restaurantPostingRestriction?.updatedByName, 'Supervisor Ada');
  assert.equal(room101.restaurantPostingHistory?.length, 2);

  console.log('ALL SECURITY HARDENING UNIT TESTS PASSED!');
}

runSecurityTests();
