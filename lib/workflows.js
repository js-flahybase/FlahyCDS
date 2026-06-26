export const WORKFLOWS = [
  { id: 'none', label: 'No workflow selected' },
  { id: 'FlahyCX', label: 'FlahyCX' },
  { id: 'FlahyOX', label: 'FlahyOX' },
  { id: 'FlahyNG', label: 'FlahyNG' },
  { id: 'FlahyOXG', label: 'FlahyOX-G' },
  { id: 'FlahyLife', label: 'FlahyLife' },
  { id: 'FlahyNPX', label: 'FlahyNPX' },
  { id: 'FlahyPX', label: 'FlahyPX' },
  { id: 'FlahyLX', label: 'FlahyLX' },
];

export function getWorkflowLabel(workflowId) {
  return WORKFLOWS.find((workflow) => workflow.id === workflowId)?.label || 'Not selected';
}
