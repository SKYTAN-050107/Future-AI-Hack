const delay = (ms = 120) => new Promise((resolve) => setTimeout(resolve, ms))

async function withMock(payload) {
  await delay()
  return { ...payload, __source: 'mock' }
}

export const gateway = {
  health: async () => withMock({ status: 'ok' }),

  getFleetSummary: async () => withMock({
    total_batteries: 0,
    avg_soh: 0,
    avg_rul: 0,
    active_alerts: 0,
  }),

  getFleetAlerts: async () => withMock({ alerts: [] }),

  uploadCsv: async (file) => withMock({
    uploaded: Boolean(file),
    filename: file?.name || null,
    rows: 0,
  }),

  getBattery: async (id) => withMock({
    cell_id: id,
    SOH: [],
    RUL: [],
    points: [],
  }),

  getBatteryRisk: async () => withMock({ breakdown: [] }),

  getBatteryScorecard: async (id) => withMock({
    cell_id: id,
    soc_score: 0,
    soh_score: 0,
    recommended_policy_tier: '-',
    maintenance_flag: false,
  }),

  getInsuranceQuote: async (id) => withMock({
    cell_id: id,
    policy_tier: '-',
    base_insured_amount: '-',
    recommended_insured_amount: '-',
    premium_rate_percent: 0,
    estimated_annual_premium: '-',
    notes: 'Mock quote data',
  }),

  getInsurancePackages: async () => withMock({ packages: [] }),

  getWeatherOutlook: async () => withMock({
    rain_probability: 76,
    best_spray_window: 'Today 3:00 PM - 5:00 PM',
    advisory: 'Avoid spraying tomorrow morning due to high rain intensity.',
  }),

  scanDisease: async () => withMock({
    disease: 'Blast',
    severity: 64,
    confidence: 92,
    spread_risk: 'High',
    zone: 'Zone C',
  }),

  getTreatmentPlan: async () => withMock({
    recommendation: 'Apply tricyclazole at 0.6 kg/ha before evening rain window.',
    estimated_cost_rm: 110,
    expected_gain_rm: 640,
    roi_x: 5.8,
    organic_alternative: 'Neem extract for low-severity sectors with follow-up scan in 48h.',
  }),
}
