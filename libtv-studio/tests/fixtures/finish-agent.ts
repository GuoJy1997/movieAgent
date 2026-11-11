import { nativeFixture, value, execute } from './native-generation';

export const finishApprove = (turn: any) => ({
  runId: turn.runId,
  approval: {
    preparedId: turn.generation.preparedId,
    approvedPlanHash: turn.generation.planHash,
    currency: 'CNY', allowanceMicros: 1000000, budgetLimitMicros: 100000000,
    acknowledgeUnknown: true, executionOwner: 'human', runId: turn.runId,
  },
});

export async function finishPrepared(
  s: Awaited<ReturnType<typeof nativeFixture>>,
  templateId: string,
  targets: unknown,
  extra: Record<string, unknown> = {},
) {
  const projectId = s.prepareInput().projectId;
  const session = value(await execute(s.engine, 'agent.createSession', {
    projectId, title: 'Finish', mode: 'director', executionOwner: 'human',
  }));
  const turn = value(await execute(s.engine, 'finish.prepareTurn', {
    sessionId: session.sessionId, message: 'Revise the selected finish content',
    profileRef: s.prepareInput().profileRef, templateId, targets, ...extra,
  }));
  return { session, turn, projectId };
}

export async function finishCompleted(
  s: Awaited<ReturnType<typeof nativeFixture>>,
  templateId: string,
  targets: unknown,
  body: unknown,
  extra: Record<string, unknown> = {},
) {
  const prepared = await finishPrepared(s, templateId, targets, extra);
  s.response({ choices: [{ message: { role: 'assistant', content: JSON.stringify(body) }, finish_reason: 'stop' }] });
  const approved = value(await execute(s.engine, 'finish.approveTurn', finishApprove(prepared.turn)));
  value(await s.engine.scheduler.run(approved.task.attemptId));
  value(await s.engine.finish.wake());
  return { ...prepared, run: value(s.engine.finish.run(prepared.turn.runId)) };
}

export const finishAcceptance = (run: any, selectedKeys: string[]) => ({
  projectId: run.projectId, runId: run.runId, proposalHash: run.proposal.proposalHash,
  selectedKeys, executionOwner: 'human',
});
