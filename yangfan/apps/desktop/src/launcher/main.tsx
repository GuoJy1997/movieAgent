import { createRoot } from 'react-dom/client';
import { Launcher } from './Launcher.tsx';
import '../../../../packages/ui/src/tokens.css';
import '../renderer/style.css';
createRoot(document.getElementById('root')!).render(<Launcher />);
