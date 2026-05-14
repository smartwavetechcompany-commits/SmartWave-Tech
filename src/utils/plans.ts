export const getDefaultModulesForPlan = (plan: string): string[] => {
  const p = plan?.toLowerCase() || 'standard';
  const core = ['dashboard', 'frontDesk', 'rooms', 'settings'];
  const standard = [...core, 'housekeeping', 'guests', 'reports'];
  const premium = [...standard, 'kitchen', 'inventory', 'maintenance', 'finance', 'staff'];
  const enterprise = [...premium, 'corporate'];
  
  if (p === 'enterprise') return enterprise;
  if (p === 'premium') return premium;
  return standard;
};

export const isModuleEnabled = (hotel: any, module: string): boolean => {
  if (!hotel) return false;
  const enabledModules = hotel.modulesEnabled || getDefaultModulesForPlan(hotel.plan || 'standard');
  return enabledModules.includes(module);
};
