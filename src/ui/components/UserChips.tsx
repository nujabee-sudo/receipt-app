import { useState } from 'react';
import { AutoComplete } from './AutoComplete';

export function UserChips({ users, options, onChange }: { users: string[]; options: string[]; onChange: (u: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const add = (name: string) => {
    const n = name.trim();
    if (n && !users.includes(n)) onChange([...users, n]);
    setDraft('');
  };
  return (
    <div className="field">
      <span>사용자</span>
      <div className="chips">
        {users.map((u) => (
          <button key={u} type="button" className="chip" aria-label={`${u} 삭제`} onClick={() => onChange(users.filter((x) => x !== u))}>
            {u} ×
          </button>
        ))}
      </div>
      <AutoComplete
        label="사용자 추가"
        hideLabel
        placeholder="이름 입력 후 Enter"
        value={draft}
        options={options.filter((o) => !users.includes(o))}
        onChange={setDraft}
        onPick={add}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add(draft);
          }
        }}
      />
    </div>
  );
}
