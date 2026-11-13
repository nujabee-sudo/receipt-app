import type { Category } from './types';

export function composeContent(site: string, item: string): string {
  const s = site.trim();
  const i = item.trim();
  return i ? `${s} : ${i}` : s;
}

const FIXED: Partial<Record<Category, string>> = {
  lodging: '숙박',
  parking: '주차',
  toll: '통행료',
  pharmacy: '약품',
  convenience: '편의점',
  material: '자재 구매',
  other: '',
};

export function suggestItem(category: Category, time: string | null, vehicle: string): string {
  const v = vehicle.trim();
  const withVehicle = (base: string) => (v ? `${base}(${v})` : base);
  switch (category) {
    case 'fuel':
      return withVehicle('주유');
    case 'urea':
      return withVehicle('요소수');
    case 'meal':
      if (time === null) return '중식';
      if (time < '10:30') return '조식';
      if (time < '16:00') return '중식';
      return '석식';
    default:
      return FIXED[category] ?? '';
  }
}
