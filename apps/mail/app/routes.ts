import { type RouteConfig, index, layout, prefix, route } from '@react-router/dev/routes';

export default [
  index('routes/index.tsx'),
  layout('routes/shell.tsx', [
    route('/mail/:view', 'routes/mail.tsx'),
    route('/subscriptions', 'routes/subscriptions.tsx'),
    ...prefix('/settings', [
      layout('routes/settings/layout.tsx', [
        index('routes/settings/index.tsx'),
        route('accounts', 'routes/settings/accounts.tsx'),
        route('signatures', 'routes/settings/signatures.tsx'),
        route('businesses', 'routes/settings/businesses.tsx'),
        route('tags', 'routes/settings/tags.tsx'),
        route('rules', 'routes/settings/rules.tsx'),
        route('notifications', 'routes/settings/notifications.tsx'),
        route('ai', 'routes/settings/ai.tsx'),
        route('activity', 'routes/settings/activity.tsx'),
        route('appearance', 'routes/settings/appearance.tsx'),
        route('security', 'routes/settings/security.tsx'),
        route('mcp', 'routes/settings/mcp.tsx'),
        route('api', 'routes/settings/api.tsx'),
      ]),
    ]),
  ]),
  route('*', 'routes/not-found.tsx'),
] satisfies RouteConfig;
