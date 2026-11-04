/** Checks shown after reading an attendance sheet: names not found, employees missing, and things to verify. */
export default function ImportNotes({ report }: { report: any }) {
  const box = 'rounded-2xl bg-warn/10 p-4 text-sm text-warn';
  return (
    <>
      {report.unmatched?.length > 0 && <div className={box}><b>{report.unmatched.length} name(s) in the sheet are not in People</b> — they are skipped. Add them in People (same name), then upload again:
        <ul className="mt-1 max-h-32 list-disc overflow-y-auto pl-5 text-xs">{report.unmatched.map((u: string) => <li key={u}>{u}</li>)}</ul></div>}
      {report.warnings?.length > 0 && <div className={box}><b>{report.warnings.length} thing(s) to check before you save</b>
        <ul className="mt-1 max-h-40 list-disc overflow-y-auto pl-5 text-xs">{report.warnings.map((w: string) => <li key={w}>{w}</li>)}</ul></div>}
      {report.missing?.length > 0 && <div className={box}><b>{report.missing.length} employee(s) not in the sheet</b> (their LOP stays 0):
        <ul className="mt-1 max-h-32 list-disc overflow-y-auto pl-5 text-xs">{report.missing.map((u: string) => <li key={u}>{u}</li>)}</ul></div>}
    </>
  );
}
