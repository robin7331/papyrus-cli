import { Input } from "@/components/ui/input";

export function DateRangeFilters(props: {
  from: string;
  to: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
}) {
  return (
    <div className="grid w-full gap-3 sm:grid-cols-2">
      <Input type="date" value={props.from} onChange={(event) => props.onFromChange(event.target.value)} />
      <Input type="date" value={props.to} onChange={(event) => props.onToChange(event.target.value)} />
    </div>
  );
}
