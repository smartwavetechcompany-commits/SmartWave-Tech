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

  console.log('ALL SECURITY HARDENING UNIT TESTS PASSED!');
}

runSecurityTests();
