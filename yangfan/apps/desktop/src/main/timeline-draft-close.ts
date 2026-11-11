import type { TimelineDraftState } from '../../../../packages/contracts/src/desktop.ts';
/** Discard applies only to the exact draft the main modal displayed. */
export function timelineDraftClose(confirm: () => Promise<'save' | 'discard' | 'cancel'>, show: () => void) {
    let draft: TimelineDraftState | null = null, asking = false;
    return {
        update(value: TimelineDraftState) { if (value.dirty)
            draft = value;
        else if (draft?.token === value.token)
            draft = null; },
        async mayQuit() {
            if (!draft)
                return true;
            if (asking)
                return false;
            asking = true;
            const token = draft.token;
            try {
                const answer = await confirm();
                if (answer === 'discard' && draft?.token === token) {
                    draft = null;
                    return true;
                }
                if (answer === 'save')
                    show();
                return false;
            }
            finally {
                asking = false;
            }
        },
    };
}
