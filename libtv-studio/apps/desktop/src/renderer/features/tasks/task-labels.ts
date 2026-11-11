import type { TaskView } from '../../../../../../packages/contracts/src/generation.ts';
export const taskLabel: Record<TaskView['state'], string> = {
  QUEUED: '等待调度',
  SUBMITTING: '正在提交',
  RUNNING: '供应方已接单',
  SUBMISSION_UNKNOWN: '提交待核实',
  RECONCILE_REQUIRED: '需要核实',
  COLLECTING: '正在收存原件',
  SUCCEEDED: '原件已保存',
  FAILED: '任务失败',
  CANCELLED: '已取消',
};
