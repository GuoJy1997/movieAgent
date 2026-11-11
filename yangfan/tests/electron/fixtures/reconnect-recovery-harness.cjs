const { utilityProcess } = require('electron');
const fork = utilityProcess.fork.bind(utilityProcess);
let executeRelease, reconcileRelease, holdExecute = true, holdFresh = true;
const state = { reconciles: 0, reconcileResponses: 0, heldEpoch: null, heldExecute: false, heldFresh: false };
globalThis.recoveryFixture = {
  state: () => ({ ...state }),
  releaseExecute() { holdExecute = false; state.heldExecute = false; const release = executeRelease; executeRelease = undefined; release?.(); },
  releaseFresh() { holdFresh = false; state.heldFresh = false; const release = reconcileRelease; reconcileRelease = undefined; release?.(); },
};
utilityProcess.fork = (...args) => {
  const child = fork(...args), post = child.postMessage.bind(child), on = child.on.bind(child), requests = new Map();
  child.postMessage = message => {
    if (message.type === 'request') {
      const reconcile = message.kind === 'provider.recover' ? ++state.reconciles : undefined;
      requests.set(message.requestId, { ...message, reconcile });
    }
    return post(message);
  };
  child.on = (event, listener) => on(event, event !== 'message' ? listener : message => {
    const request = message.type === 'response' && requests.get(message.requestId);
    if (request) requests.delete(message.requestId);
    if (request?.reconcile) {
      state.reconcileResponses++;
      if (request.reconcile === 2 && holdFresh) { state.heldFresh = true; reconcileRelease = () => listener(message); return; }
    }
    if (request?.kind === 'execute' && request.payload.commandId === 'held-recovery' && holdExecute) {
      state.heldEpoch = request.payload.connectionEpoch; state.heldExecute = true; executeRelease = () => listener(message); return;
    }
    return listener(message);
  });
  return child;
};
require(process.argv.find(value => value.startsWith('--production-entry=')).slice('--production-entry='.length));
