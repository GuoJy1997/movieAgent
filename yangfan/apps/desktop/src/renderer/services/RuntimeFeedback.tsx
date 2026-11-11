import { Button } from '../../../../../packages/ui/src/controls.tsx';
import { useRuntime } from './runtime.tsx';
export function RuntimeFeedback() {
  const runtime = useRuntime();
  if (!runtime.error) return null;
  return (
    <div role="alert" className="alert">
      <p>{runtime.error.message}</p>
      {Object.entries(runtime.error.fieldErrors ?? {}).map(([field, message]) => (
        <p key={field}>
          {field}: {message}
        </p>
      ))}
      {runtime.pending && (
        <Button disabled={runtime.busy} onClick={() => void runtime.recover()}>
          核实原回执
        </Button>
      )}
    </div>
  );
}
