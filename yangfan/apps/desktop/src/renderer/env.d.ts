import type { DesktopBridge } from '../../../../packages/contracts/src/desktop.ts';
declare global {
  interface Window { studio: DesktopBridge }
}
