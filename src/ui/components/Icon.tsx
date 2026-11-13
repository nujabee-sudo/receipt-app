// 선 아이콘. 글자색(currentColor)을 따라가서 밝은·어두운 화면 모두에서 맞는다.
const PATHS = {
  back: 'M15 5l-7 7 7 7',
  prev: 'M15 5l-7 7 7 7',
  next: 'M9 5l7 7-7 7',
  gear: 'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM19.4 13.5l1.6 1.2-1.8 3.1-1.9-.7a7 7 0 0 1-1.8 1l-.3 2h-3.6l-.3-2a7 7 0 0 1-1.8-1l-1.9.7L5 14.7l1.6-1.2a7 7 0 0 1 0-3L5 9.3l1.8-3.1 1.9.7a7 7 0 0 1 1.8-1l.3-2h3.6l.3 2a7 7 0 0 1 1.8 1l1.9-.7L21 9.3l-1.6 1.2a7 7 0 0 1 0 3z',
  camera: 'M4 8.5A1.5 1.5 0 0 1 5.5 7h2.2l1.5-2h5.6l1.5 2h2.2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5zM12 16a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z',
  doc: 'M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10A.5.5 0 0 1 7 20zM14 3.5V8h4M9.5 12h6M9.5 15.5h6',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
