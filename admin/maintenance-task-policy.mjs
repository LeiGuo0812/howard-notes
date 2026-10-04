// Task origin belongs to the submitted operation, rather than whichever panel
// happens to be visible when a late acknowledgement arrives. Retaining a
// window never reopens it after an explicit minimize, close or navigation.
export function keepMaintenanceTaskWindowOpen(task) {
  return task?.panel === "trash" && ["purge", "restore"].includes(task.kind)
}
