interface ColumnCountControlProps {
  value: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
}

// Emits a column count to the parent. The translation to targetRowHeight
// happens in MediaFeed, where containerWidth lives — the control deliberately
// doesn't know about pixel dimensions. See CLAUDE.md §5 pillar 1.
export function ColumnCountControl({
  value,
  min = 2,
  max = 8,
  onChange,
}: ColumnCountControlProps) {
  return (
    <div className="control">
      <label className="control-label">
        <span>Columns: {value}</span>
        <input
          type="range"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </label>
    </div>
  );
}
