/**
 * Blood Glucose (capillary) thresholds & status constants.
 * Informational only, not diagnostic.
 */

export const GLUCOSE_THRESHOLDS = {
  LOW_MAX: 70,       // < 70 mg/dL: low
  NORMAL_MAX: 140,   // 70 - 140 mg/dL: in range
  // > 140 mg/dL: high
}

export function getGlucoseStatus(mgdl) {
  if (mgdl == null || typeof mgdl !== 'number' || Number.isNaN(mgdl)) {
    return {
      status: 'not measured',
      label: 'not measured',
      statusBg: 'bg-slate-100',
      statusText: 'text-slate-500',
    }
  }

  if (mgdl < GLUCOSE_THRESHOLDS.LOW_MAX) {
    return {
      status: 'low',
      label: 'low',
      statusBg: 'bg-[#FEE2E2]',
      statusText: 'text-red-700',
    }
  }

  if (mgdl <= GLUCOSE_THRESHOLDS.NORMAL_MAX) {
    return {
      status: 'in range',
      label: 'in range',
      statusBg: 'bg-[#ECFDF5]',
      statusText: 'text-green-700',
    }
  }

  return {
    status: 'high',
    label: 'high',
    statusBg: 'bg-[#FFFBEB]',
    statusText: 'text-orange-600',
  }
}
