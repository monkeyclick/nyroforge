# NyroForge Frontend Roadmap

This roadmap captures the work that follows the initial visual redesign and component-architecture pass. Priorities favor reliability and user outcomes over additional cosmetic changes.

## Now: Component architecture

- [x] Introduce shared `AppShell`, primary navigation, theme hook, and status components.
- [x] Extract `WorkstationActions`, `StudioHero`, `StudioStats`, and `StudioFilters`.
- [x] Extract typed, responsive admin navigation.
- [x] Extract the remaining workstation presentation into `WorkstationCard`.
- [x] Extract dashboard account and cost insights into `DashboardInsights`.
- [x] Extract admin summary and system-information panels.
- [x] Extract the admin workstation fleet table and action presentation.
- [ ] Break the remaining admin feature bodies into fleet, people, infrastructure, intelligence, and settings modules.
- Keep API queries and mutations in page-level controller hooks until their behavior has test coverage.

**Done when:** pages primarily compose focused components, shared navigation has one implementation, and no API behavior changes during extraction.

## Next: Automated frontend testing

- [x] Establish a Next.js-aware Jest and Testing Library component-test harness.
- [x] Cover shared metrics, filters, navigation, status, and lifecycle-action components.
- [x] Cover workstation cards, dashboard insights, and admin system summaries.
- Add Playwright with deterministic Cognito and API mocks.
- Cover authentication redirects, theme persistence, workstation lifecycle actions, connection dialogs, permissions, errors, and mobile layouts.
- Add automated accessibility checks with axe.

**Done when:** critical user journeys run in CI without live AWS credentials.

## Next: Workstation action hierarchy

- Make Connect the dominant action and start/stop the contextual secondary action.
- Move software, collaborators, reboot, and termination into structured secondary menus.
- Visually and spatially separate destructive actions.

**Done when:** routine tasks are obvious and destructive actions cannot be triggered accidentally.

## Planned: Activity center

- Add persistent progress for provisioning, software installation, power transitions, and failures.
- Provide recovery guidance and recent completed activity.

**Done when:** users can leave a modal and still understand every operation in progress.

## Planned: Search and filters

- Add search by workstation, owner, collaborator, project, and team.
- Filter by state, region, GPU family, session expiry, and cost.
- Store filter state in the URL for bookmarkable views.

## Planned: Productions and projects

- Group workstations, collaborators, storage, software, budgets, and activity into production workspaces.
- Add production-level roles and cost attribution.

## Planned: Actionable cost controls

- Show live session cost, idle warnings, project budgets, and shutdown recommendations.
- Report cost by production, team, and user rather than exposing raw infrastructure data alone.

## Planned: Complete design-system migration

- Replace hard-coded color utilities with semantic surface, text, border, action, and status primitives.
- Validate contrast, keyboard focus, reduced motion, and touch-target sizing in both themes.

## Planned: Project health

- Remove obsolete Next.js configuration keys and resolve static-export header behavior.
- Choose a single workspace/lockfile strategy.
- Eliminate the existing ESLint warning backlog.
- Validate required environment variables during build and update version/deployment documentation.

## Planned: Product observability

- Measure launch-to-ready time, connection success, installation duration, idle time, provisioning failures, session extensions, and avoided cost.
- Define privacy-safe retention and dashboards before collecting new events.

## Suggested delivery order

1. Component architecture
2. Automated frontend testing
3. Workstation action hierarchy
4. Activity center
5. Search and filters
6. Project health cleanup
7. Productions and projects
8. Cost controls
9. Design-system completion
10. Product observability
