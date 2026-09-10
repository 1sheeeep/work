import { OperationalTaskWorkspace } from './SettingsSystemPages'
import { ProcurementReviewPage } from './ProcurementReviewPage'

export function SettingsApprovalDocumentsPage() {
  return <ProcurementReviewPage
    path="/settings/tasks/approvals"
    title="审核单据"
    description="集中处理待审核采购单，并查询已批准或已驳回的审核记录。"
    settingsSection="任务公告"
  />
}

export { SettingsMessageCenterPage } from './SettingsMessageCenterPage'
export { SettingsTransferTasksPage as SettingsImportExportTasksPage } from './SettingsTransferTasksPage'
export { SettingsAttachmentDownloadsPage } from './SettingsAttachmentDownloadsPage'
export { SettingsTaskCenterPage } from './SettingsTaskCenterPage'
export { SettingsInternalNoticesPage } from './SettingsInternalNoticesPage'

export function SettingsTaskListPage() {
  return <OperationalTaskWorkspace
    path="/settings/tasks/list"
    title="任务列表"
    description="集中查看和处理企业运营任务。"
    section="任务公告"
  />
}
