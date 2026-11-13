import type { Photo } from '../../domain/types';
import { useObjectUrl } from '../hooks';

export function Thumb({ photo, className = 'thumb' }: { photo: Photo | undefined; className?: string }) {
  const url = useObjectUrl(photo?.processed ?? photo?.original ?? null);
  return url ? <img className={className} src={url} alt="" /> : <div className={`${className} thumb-empty`} />;
}
