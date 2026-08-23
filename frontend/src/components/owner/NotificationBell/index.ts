// La cloche vit dans la topbar du tableau de bord (DashboardTopBar), alimentée
// par useNotifications. Ce dossier ne garde que la liste, partagée avec la
// page /dashboard/notifications.
export { NotificationList, default as NotificationListDefault } from './NotificationList';
export type { NotificationRow } from './NotificationList';
