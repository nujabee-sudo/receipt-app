import { useId, useState, type KeyboardEvent } from 'react';

interface Props {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
  onPick?: (v: string) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  placeholder?: string;
  hideLabel?: boolean;
}

/** 최근 값 목록에서 고르거나 직접 입력하는 칸 */
export function AutoComplete({ label, value, options, onChange, onPick, onKeyDown, placeholder, hideLabel }: Props) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const q = value.trim().toLowerCase();
  const matches = options.filter((o) => o !== value && (!q || o.toLowerCase().includes(q))).slice(0, 6);

  const pick = (o: string) => {
    onChange(o);
    onPick?.(o);
    setOpen(false);
  };

  return (
    <div className="field ac">
      {!hideLabel && <span>{label}</span>}
      <input
        aria-label={label}
        role="combobox"
        aria-expanded={open && matches.length > 0}
        aria-controls={listId}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />
      {open && matches.length > 0 && (
        <ul id={listId} role="listbox" className="ac-list">
          {matches.map((o) => (
            <li key={o} role="option" aria-selected={false} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(o)}>
              {o}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
