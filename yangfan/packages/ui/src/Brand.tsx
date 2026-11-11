import mascot from './assets/yangfan-mascot.png';
export function Brand({compact = false}: {compact?: boolean}) {
  return <div className={compact ? 'yangfan-brand compact' : 'yangfan-brand'} aria-label="羊番TV">
    <img src={mascot} alt="" draggable={false} />
    {!compact && <span>羊番TV</span>}
  </div>;
}
export {mascot};