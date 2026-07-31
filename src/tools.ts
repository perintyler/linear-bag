import { defineTool, type ToolContext } from "@barry/tools";
import { z } from "zod";
import { TicketingService } from "./ticketing-service.js";
import type { Ticket, Comment } from "./types.js";

function formatTicketList(tickets: Ticket[]): string {
  if (!tickets.length) return "No tickets found.";
  return tickets.map((t) => {
    const assignee = t.assignee ? `  @${t.assignee.name}` : "";
    return `${t.identifier}  ${t.status.name}  ${t.title}${assignee}`;
  }).join("\n");
}

export { TicketingService } from "./ticketing-service.js";

// Cache the service per API key (secrets are resolved per-profile and re-resolved
// per turn, so rebuild only when the key actually changes).
let service: TicketingService | null = null;
let serviceKey: string | null = null;

function getService(context?: ToolContext): TicketingService {
  const apiKey = context?.secrets.LINEAR_API_KEY;
  if (!apiKey) {
    throw new Error("LINEAR_API_KEY not set — add it to the active profile's secrets");
  }
  if (!service || serviceKey !== apiKey) {
    service = new TicketingService(apiKey);
    serviceKey = apiKey;
  }
  return service;
}

export const ticketGet = defineTool({
  namespace: "linear",
  access: "read",
  secrets: ["LINEAR_API_KEY"],
  name: "ticket_get",
  description: "Get a ticket by identifier (e.g. BAR-123). Returns full details including status, assignee, labels, and sub-issues.",
  schema: {
    identifier: z.string().describe("Ticket identifier (e.g. BAR-123)"),
  },
  handler: async ({ identifier }, context) => {
    return getService(context).getTicket(identifier);
  },
  cliFormat: (result) => {
    const t = result as Ticket;
    const lines: string[] = [];
    lines.push(`${t.identifier}: ${t.title}`);
    lines.push(`Status: ${t.status.name}`);
    if (t.assignee) lines.push(`Assignee: ${t.assignee.name}`);
    if (t.labels.length) lines.push(`Labels: ${t.labels.map((l) => l.name).join(", ")}`);
    if (t.project) lines.push(`Project: ${t.project.name}`);
    lines.push(`Priority: ${t.priority}`);
    if (t.parent) lines.push(`Parent: ${t.parent.identifier} ${t.parent.title}`);
    if (t.children.length) {
      lines.push(`Sub-issues:`);
      for (const c of t.children) lines.push(`  ${c.identifier} ${c.title}`);
    }
    lines.push(`URL: ${t.url}`);
    return lines.join("\n");
  },
});

export const ticketList = defineTool({
  namespace: "linear",
  access: "read",
  secrets: ["LINEAR_API_KEY"],
  name: "ticket_list",
  description: `List tickets with filters. By default excludes completed tickets.

Examples:
- All open tickets: ticket_list
- My tickets: ticket_list assignee="me"
- By status: ticket_list status="In Progress"
- By label: ticket_list label="bug"`,
  schema: {
    team: z.string().optional().describe("Team key (e.g. BAR)"),
    assignee: z.string().optional().describe('Assignee name or "me" for current user'),
    status: z.string().optional().describe("Filter by status name"),
    label: z.string().optional().describe("Filter by label name"),
    project: z.string().optional().describe("Filter by project name"),
    limit: z.number().min(1).max(100).optional().describe("Max results (default: 50)"),
    include_completed: z.boolean().optional().describe("Include completed tickets (default: false)"),
  },
  handler: async ({ team, assignee, status, label, project, limit, include_completed }, context) => {
    const tickets = await getService(context).listTickets({
      team,
      assignee,
      status,
      label,
      project,
      limit,
      includeCompleted: include_completed,
    });
    return { count: tickets.length, tickets };
  },
  cliFormat: (result) => {
    const r = result as { count: number; tickets: Ticket[] };
    if (!r.tickets.length) return "No tickets found.";
    return `${r.count} ticket(s):\n\n${formatTicketList(r.tickets)}`;
  },
});

export const ticketSearch = defineTool({
  namespace: "linear",
  access: "read",
  secrets: ["LINEAR_API_KEY"],
  name: "ticket_search",
  description: "Full-text search across all tickets.",
  schema: {
    query: z.string().describe("Search query"),
    limit: z.number().min(1).max(100).optional().describe("Max results (default: 20)"),
  },
  handler: async ({ query, limit }, context) => {
    const tickets = await getService(context).searchTickets(query, limit);
    return { count: tickets.length, tickets };
  },
  cliFormat: (result) => {
    const r = result as { count: number; tickets: Ticket[] };
    if (!r.tickets.length) return "No results.";
    return `${r.count} result(s):\n\n${formatTicketList(r.tickets)}`;
  },
});

export const ticketListComments = defineTool({
  namespace: "linear",
  access: "read",
  secrets: ["LINEAR_API_KEY"],
  name: "ticket_list_comments",
  description: "Get all comments on a ticket.",
  schema: {
    identifier: z.string().describe("Ticket identifier (e.g. BAR-123)"),
  },
  handler: async ({ identifier }, context) => {
    const comments = await getService(context).listComments(identifier);
    return { count: comments.length, comments };
  },
  cliFormat: (result) => {
    const r = result as { count: number; comments: Comment[] };
    if (!r.comments.length) return "No comments.";
    return r.comments.map((c) => {
      const author = c.user?.name ?? "Unknown";
      return `${author} (${c.createdAt}):\n${c.body}`;
    }).join("\n\n---\n\n");
  },
});

export const ticketListStatuses = defineTool({
  namespace: "linear",
  access: "read",
  secrets: ["LINEAR_API_KEY"],
  name: "ticket_list_statuses",
  description: "List available workflow statuses for a team.",
  schema: {
    team: z.string().describe("Team key (e.g. BAR)"),
  },
  handler: async ({ team }, context) => {
    return getService(context).listStatuses(team);
  },
  cliFormat: (result) => {
    const statuses = result as Array<{ name: string; type: string }>;
    if (!statuses.length) return "No statuses.";
    return statuses.map((s) => `${s.name} (${s.type})`).join("\n");
  },
});

export const ticketListTeams = defineTool({
  namespace: "linear",
  access: "read",
  secrets: ["LINEAR_API_KEY"],
  name: "ticket_list_teams",
  description: "List all teams in the workspace.",
  schema: {},
  handler: async (_params, context) => {
    return getService(context).listTeams();
  },
  cliFormat: (result) => {
    const teams = result as Array<{ key: string; name: string }>;
    if (!teams.length) return "No teams.";
    return teams.map((t) => `${t.key}  ${t.name}`).join("\n");
  },
});

export const ticketListLabels = defineTool({
  namespace: "linear",
  access: "read",
  secrets: ["LINEAR_API_KEY"],
  name: "ticket_list_labels",
  description: "List available labels, optionally filtered by team.",
  schema: {
    team: z.string().optional().describe("Team key to filter labels"),
  },
  handler: async ({ team }, context) => {
    return getService(context).listLabels(team);
  },
  cliFormat: (result) => {
    const labels = result as Array<{ name: string; color: string }>;
    if (!labels.length) return "No labels.";
    return labels.map((l) => `${l.name} (${l.color})`).join("\n");
  },
});

export const ticketGetProject = defineTool({
  namespace: "linear",
  access: "read",
  secrets: ["LINEAR_API_KEY"],
  name: "ticket_get_project",
  description: "Get project details by name.",
  schema: {
    name: z.string().describe("Project name (partial match)"),
  },
  handler: async ({ name }, context) => {
    return getService(context).getProject(name);
  },
});

export const ticketGetCycle = defineTool({
  namespace: "linear",
  access: "read",
  secrets: ["LINEAR_API_KEY"],
  name: "ticket_get_cycle",
  description: "Get cycle/sprint information for a team.",
  schema: {
    team: z.string().describe("Team key (e.g. BAR)"),
    current: z.boolean().optional().describe("Get current active cycle (default)"),
    number: z.number().optional().describe("Get specific cycle by number"),
  },
  handler: async ({ team, current, number }, context) => {
    return getService(context).getCycle(team, { current: current ?? !number, number });
  },
});

export const ticketingStatus = defineTool({
  namespace: "linear",
  access: "read",
  secrets: ["LINEAR_API_KEY"],
  name: "ticketing_status",
  description: "Check ticketing API connectivity and workspace info.",
  schema: {},
  handler: async (_params, context) => {
    const hasKey = !!context?.secrets.LINEAR_API_KEY;
    if (!hasKey) {
      return { status: "disconnected", error: "LINEAR_API_KEY not set" };
    }
    try {
      const workspace = await getService(context).getWorkspace();
      return { status: "connected", workspace };
    } catch (e) {
      return { status: "error", error: e instanceof Error ? e.message : String(e) };
    }
  },
  cliFormat: (result) => {
    const r = result as { status: string; workspace?: { name: string }; error?: string };
    if (r.status !== "connected") return `Status: ${r.status}${r.error ? `\nError: ${r.error}` : ""}`;
    return `Status: connected\nWorkspace: ${r.workspace?.name ?? "unknown"}`;
  },
});

export const ticketUpdate = defineTool({
  namespace: "linear",
  access: "write",
  secrets: ["LINEAR_API_KEY"],
  name: "ticket_update",
  description: `Update a ticket's fields. Only specified fields are changed.

Examples:
- Change status: ticket_update identifier="BAR-1" status="Done"
- Assign: ticket_update identifier="BAR-1" assignee="Tyler"
- Set priority: ticket_update identifier="BAR-1" priority=1`,
  schema: {
    identifier: z.string().describe("Ticket identifier (e.g. BAR-123)"),
    status: z.string().optional().describe("New status name"),
    assignee: z.string().optional().describe("New assignee name"),
    priority: z.number().min(0).max(4).optional().describe("Priority: 0=none, 1=urgent, 2=high, 3=medium, 4=low"),
    title: z.string().optional().describe("New title"),
    description: z.string().optional().describe("New description (markdown)"),
    label: z.string().optional().describe("Set label by name"),
  },
  handler: async ({ identifier, status, assignee, priority, title, description, label }, context) => {
    return getService(context).updateTicket(identifier, { status, assignee, priority, title, description, label });
  },
  cliFormat: (result) => {
    const t = result as Ticket;
    return `Updated ${t.identifier}: ${t.title}\nURL: ${t.url}`;
  },
});

export const ticketAddComment = defineTool({
  namespace: "linear",
  access: "write",
  secrets: ["LINEAR_API_KEY"],
  name: "ticket_add_comment",
  description: "Add a markdown comment to a ticket.",
  schema: {
    identifier: z.string().describe("Ticket identifier (e.g. BAR-123)"),
    body: z.string().describe("Comment body (markdown)"),
  },
  handler: async ({ identifier, body }, context) => {
    return getService(context).addComment(identifier, body);
  },
});

export const ticketCreate = defineTool({
  namespace: "linear",
  access: "write",
  secrets: ["LINEAR_API_KEY"],
  name: "ticket_create",
  description: `Create a new ticket or sub-issue.

Examples:
- Simple: ticket_create title="Fix login bug" team="BAR"
- With details: ticket_create title="Add caching" team="BAR" priority=2 status="In Progress"
- Sub-issue: ticket_create title="Write tests" team="BAR" parent="BAR-5"`,
  schema: {
    title: z.string().describe("Ticket title"),
    team: z.string().describe("Team key (e.g. BAR)"),
    description: z.string().optional().describe("Description (markdown)"),
    status: z.string().optional().describe("Initial status name"),
    assignee: z.string().optional().describe("Assignee name"),
    priority: z.number().min(0).max(4).optional().describe("Priority: 0=none, 1=urgent, 2=high, 3=medium, 4=low"),
    label: z.string().optional().describe("Label name"),
    parent: z.string().optional().describe("Parent ticket identifier for sub-issues"),
  },
  handler: async ({ title, team, description, status, assignee, priority, label, parent }, context) => {
    return getService(context).createTicket({ title, team, description, status, assignee, priority, label, parent });
  },
  cliFormat: (result) => {
    const t = result as Ticket;
    return `Created ${t.identifier}: ${t.title}\nURL: ${t.url}`;
  },
});
