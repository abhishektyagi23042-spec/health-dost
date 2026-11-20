import { useMemo } from 'react'
import { getGlucoseStatus } from '../constants/glucose'

export default function GlucoseCard({
  glucoseData,
  syncing = false,
  onSync,
}) {
  const mgdl = glucoseData?.mgdl ?? null
  const timestamp = glucoseData?.timestamp ?? null

  const { status, statusBg, statusText } = useMemo(() => {
    return getGlucoseStatus(mgdl)
  }, [mgdl])

  const timeLabel = useMemo(() => {
    if (!timestamp) return null
    try {
      const d = new Date(timestamp)
      if (Number.isNaN(d.getTime())) return null
      const h = String(d.getHours()).padStart(2, '0')
      const m = String(d.getMinutes()).padStart(2, '0')
      return `measured ${h}:${m}`
    } catch {
      return null
    }
  }, [timestamp])

  return (
    <div className="h-[120px] bg-white rounded-xl shadow-md p-2.5 flex flex-col justify-between min-w-0 flex-1">
      {/* Header: Icon + Title */}
      <div className="flex items-center gap-1.5 shrink-0">
        <div className="w-[30px] h-[30px] rounded-lg bg-[#FEE2E2] flex items-center justify-center shrink-0">
          <img src="/icons/glucose.svg" alt="" className="w-[18px] h-[18px] object-contain" />
        </div>
        <div className="flex-1 text-right leading-tight min-w-0">
          <span className="font-['Mulish'] text-[9px] leading-[12px] text-[#2d3035] font-bold block">
            Blood Glucose
          </span>
          <span className="font-['Mulish'] text-[7.5px] leading-[9px] text-slate-400 font-normal block">
            (capillary)
          </span>
        </div>
      </div>

      {/* Value & Meter Time */}
      <div className="flex items-baseline justify-between gap-1 shrink-0">
        <div className="flex items-baseline gap-0.5">
          <span className="font-['Mulish'] text-[#2d3035] font-bold text-base">
            {mgdl != null ? mgdl : '--'}
          </span>
          <span className="font-['Mulish'] text-slate-500 text-xs">mg/dL</span>
        </div>
        {timeLabel ? (
          <span className="font-['Mulish'] text-slate-400 text-[8px] truncate">
            {timeLabel}
          </span>
        ) : null}
      </div>

      {/* Status badge + Sync button */}
      <div className="flex items-center justify-between gap-1 shrink-0">
        <div className={`w-fit shrink-0 flex items-center justify-center py-0.5 px-1.5 rounded-md ${statusBg} ${statusText}`}>
          <span className="font-['Mulish'] text-[8px] font-medium leading-tight whitespace-nowrap">
            {status}
          </span>
        </div>

        <button
          type="button"
          onClick={onSync}
          disabled={syncing}
          className="font-['Space_Grotesk'] text-[8.5px] font-medium text-[#2d3035] bg-[#ebddfa] hover:bg-[#E0C8FF] px-2 py-0.5 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1 shrink-0 cursor-pointer"
          title="Take the test on the meter, then press Sync."
        >
          {syncing ? (
            <>
              <span className="inline-block animate-spin w-2 h-2 border-[1.5px] border-[#2d3035] border-t-transparent rounded-full"></span>
              <span>Syncing…</span>
            </>
          ) : (
            <span>Sync</span>
          )}
        </button>
      </div>

      {/* Instructions */}
      <div className="shrink-0">
        <p className="font-['Mulish'] text-[7.5px] leading-[9px] text-slate-400 truncate" title="Take the test on the meter, then press Sync.">
          Take test on meter, then Sync
        </p>
      </div>
    </div>
  )
}
