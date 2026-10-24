/// <reference types="@cloudflare/workers-types" />
/**
 * The serving half of the report catalogue: the one object every surface is a projection
 * of, and the two HTTP surfaces over it. A separate subpath from ../catalogue because it
 * stands on app-kit's api, whose door runs on `cloudflare:workers`; the catalogue itself
 * runs anywhere zod does.
 *
 *   ReportCap        the class is the list (app-kit's doctrine): one method per read of
 *                    the catalogue, each a line over `callOperation`, holding the context
 *                    it was constructed with. room-service's `capabilityMethods` reads
 *                    them live, so the same object is the applet a host holds over its
 *                    door, the tool list an MCP client sees and the routes a REST caller
 *                    may call. A read this run does not serve is not a tool or a route
 *                    (`surfaceOf` joins the methods to the catalogue's served operations)
 *                    and answers NotFound over the socket.
 *   serveReportMcp   the MCP server for one request: the capability's surface as tools,
 *                    the resource bindings, the view where the client can show one, the
 *                    skills, and the Tasks extension for a caller who owns a task room.
 *   reportRest       the REST router over the catalogue, built once per catalogue.
 *
 * Who is asking, and whether they may own tasks, is the host's (../../server/report-auth);
 * nothing here reads a credential.
 */
import {
	type CallHooks,
	callOperation,
	clientCapabilitiesOf,
	NotFound,
	type RestOptions,
	type RestRouter,
	registerMcpTools,
	restRouter,
} from '@aicolab/app-kit/api'
import { registerMcpSkills, type Skill } from '@aicolab/app-kit/api/skills'
import {
	createTaskEventBus,
	registerMcpTasks,
	type TaskDoor,
	type TaskWatch,
} from '@aicolab/app-kit/tasks'
import { capabilityMethods, RpcTarget } from '@aicolab/room-service/base-room'
import { type AuthInfo, createMcpHandler, McpServer } from '@modelcontextprotocol/server'
import type { ReportCtx } from './context.ts'
import type { ReportCatalogue } from './index.ts'

/**
 * The report as one object: a method per read, over the context it was constructed with.
 * Every method takes the caller's hooks as its second argument (`CallHooks`): over the
 * socket the browser's callbacks, over MCP and REST what those surfaces build from the
 * request. A report with reads of its own extends this class with them.
 */
export class ReportCap extends RpcTarget {
	readonly #catalogue: ReportCatalogue
	protected readonly ctx: ReportCtx

	constructor(catalogue: ReportCatalogue, ctx: ReportCtx) {
		super()
		this.#catalogue = catalogue
		this.ctx = ctx
	}

	/** One read by name, validated by its own input; a read this run does not serve is not found. */
	#read(name: string, input: unknown, hooks?: CallHooks): Promise<unknown> {
		const operation = this.#catalogue.byName.get(name)
		if (!operation || !this.#catalogue.served.has(name)) {
			return Promise.reject(new NotFound(`This report does not serve ${name}.`))
		}
		return callOperation(operation, input, this.ctx, hooks)
	}

	// ---- orientation & search ----
	corpus_overview(input: unknown, hooks?: CallHooks) {
		return this.#read('corpus_overview', input, hooks)
	}
	search_passages(input: unknown, hooks?: CallHooks) {
		return this.#read('search_passages', input, hooks)
	}
	find_topics(input: unknown, hooks?: CallHooks) {
		return this.#read('find_topics', input, hooks)
	}
	list_topics(input: unknown, hooks?: CallHooks) {
		return this.#read('list_topics', input, hooks)
	}
	search(input: unknown, hooks?: CallHooks) {
		return this.#read('search', input, hooks)
	}
	fetch(input: unknown, hooks?: CallHooks) {
		return this.#read('fetch', input, hooks)
	}

	// ---- the grouping tree ----
	list_families(input: unknown, hooks?: CallHooks) {
		return this.#read('list_families', input, hooks)
	}
	list_superclusters(input: unknown, hooks?: CallHooks) {
		return this.#read('list_superclusters', input, hooks)
	}
	topics_in_supercluster(input: unknown, hooks?: CallHooks) {
		return this.#read('topics_in_supercluster', input, hooks)
	}

	// ---- a topic ----
	get_topic(input: unknown, hooks?: CallHooks) {
		return this.#read('get_topic', input, hooks)
	}
	topic_quotes(input: unknown, hooks?: CallHooks) {
		return this.#read('topic_quotes', input, hooks)
	}
	topic_perspectives(input: unknown, hooks?: CallHooks) {
		return this.#read('topic_perspectives', input, hooks)
	}
	source_perspectives(input: unknown, hooks?: CallHooks) {
		return this.#read('source_perspectives', input, hooks)
	}
	related_topics(input: unknown, hooks?: CallHooks) {
		return this.#read('related_topics', input, hooks)
	}
	contested_topics(input: unknown, hooks?: CallHooks) {
		return this.#read('contested_topics', input, hooks)
	}

	// ---- who ----
	lens_profile(input: unknown, hooks?: CallHooks) {
		return this.#read('lens_profile', input, hooks)
	}
	list_sources(input: unknown, hooks?: CallHooks) {
		return this.#read('list_sources', input, hooks)
	}
	get_source(input: unknown, hooks?: CallHooks) {
		return this.#read('get_source', input, hooks)
	}

	// ---- documents ----
	find_documents(input: unknown, hooks?: CallHooks) {
		return this.#read('find_documents', input, hooks)
	}
	get_document(input: unknown, hooks?: CallHooks) {
		return this.#read('get_document', input, hooks)
	}
	document_text(input: unknown, hooks?: CallHooks) {
		return this.#read('document_text', input, hooks)
	}

	// ---- facets & vocabularies ----
	list_tags(input: unknown, hooks?: CallHooks) {
		return this.#read('list_tags', input, hooks)
	}
	tag_pivot(input: unknown, hooks?: CallHooks) {
		return this.#read('tag_pivot', input, hooks)
	}
	list_vocabularies(input: unknown, hooks?: CallHooks) {
		return this.#read('list_vocabularies', input, hooks)
	}
	get_concept(input: unknown, hooks?: CallHooks) {
		return this.#read('get_concept', input, hooks)
	}
	entities_for_concept(input: unknown, hooks?: CallHooks) {
		return this.#read('entities_for_concept', input, hooks)
	}
	documents_for_concept(input: unknown, hooks?: CallHooks) {
		return this.#read('documents_for_concept', input, hooks)
	}

	// ---- custom analysis ----
	list_questions(input: unknown, hooks?: CallHooks) {
		return this.#read('list_questions', input, hooks)
	}
	question_answers(input: unknown, hooks?: CallHooks) {
		return this.#read('question_answers', input, hooks)
	}
	task_results(input: unknown, hooks?: CallHooks) {
		return this.#read('task_results', input, hooks)
	}
	analysis(input: unknown, hooks?: CallHooks) {
		return this.#read('analysis', input, hooks)
	}
	analysis_drill(input: unknown, hooks?: CallHooks) {
		return this.#read('analysis_drill', input, hooks)
	}

	// ---- the long reads: inline here, with the caller's hooks; durable tasks through the room ----
	reading_list(input: unknown, hooks?: CallHooks) {
		return this.#read('reading_list', input, hooks)
	}
	draft_brief(input: unknown, hooks?: CallHooks) {
		return this.#read('draft_brief', input, hooks)
	}
	compare_sources(input: unknown, hooks?: CallHooks) {
		return this.#read('compare_sources', input, hooks)
	}

	// ---- the report's pages ----
	report_overview(input: unknown, hooks?: CallHooks) {
		return this.#read('report_overview', input, hooks)
	}
	brief(input: unknown, hooks?: CallHooks) {
		return this.#read('brief', input, hooks)
	}
	chapter_reading(input: unknown, hooks?: CallHooks) {
		return this.#read('chapter_reading', input, hooks)
	}
	sources_record(input: unknown, hooks?: CallHooks) {
		return this.#read('sources_record', input, hooks)
	}
	galaxy(input: unknown, hooks?: CallHooks) {
		return this.#read('galaxy', input, hooks)
	}
	method(input: unknown, hooks?: CallHooks) {
		return this.#read('method', input, hooks)
	}

	// ---- the four readings a drawer opens ----
	topic_reading(input: unknown, hooks?: CallHooks) {
		return this.#read('topic_reading', input, hooks)
	}
	group_reading(input: unknown, hooks?: CallHooks) {
		return this.#read('group_reading', input, hooks)
	}
	source_reading(input: unknown, hooks?: CallHooks) {
		return this.#read('source_reading', input, hooks)
	}
	document_reading(input: unknown, hooks?: CallHooks) {
		return this.#read('document_reading', input, hooks)
	}

	/** What this object can do, read from its class: not an operation, so never a tool or a route. */
	availableMethods() {
		return capabilityMethods(this)
	}
}

/** The caller's tasks, for a caller who may own them (a signed-in viewer): the worker door to
 *  their room (start, read, answer, cancel), and the watch that hears the room change. */
export interface ReportTasks {
	door: TaskDoor
	watch: TaskWatch
}

export interface ServeReportMcpOptions {
	/** The object whose surface is the tool list; every tool calls it. */
	capability: RpcTarget
	catalogue: ReportCatalogue
	/** What the server calls itself (`initialize`). */
	server: { name: string; version: string }
	/** The connector's instructions (../catalogue `reportInstructions`). */
	instructions: string
	/** The skills for working with this report, where the host serves any. */
	skills?: readonly Skill[]
	/** The verified access token, for a request that presented one. */
	authInfo?: AuthInfo
	/** The caller's tasks; null or absent, every long read answers inline. */
	tasks?: ReportTasks | null
}

/** The JSON-RPC body of a POST, read once for the host (its challenge, the client's declared capabilities). */
export async function mcpBodyOf(request: Request): Promise<unknown> {
	if (request.method !== 'POST') return undefined
	return request
		.clone()
		.json()
		.catch(() => undefined)
}

/**
 * Serve one MCP request as this capability: the tool list is its surface, every tool calls
 * it; each read with a resource binding is a resource; the readings' view is offered to a
 * client that declared the UI extension; the skills are served; a client that declared the
 * Tasks extension is handed a long read as a task, when the caller owns a room. The body
 * was read once by the Worker and is handed on pre-parsed. With the caller's tasks, the
 * handler's event bus is the owner's task room: a `subscriptions/listen` stream that
 * subscribed to a task's resource hears `notifications/resources/updated` as the room pushes.
 */
export async function serveReportMcp(
	request: Request,
	body: unknown,
	options: ServeReportMcpOptions,
): Promise<Response> {
	const client = clientCapabilitiesOf(body)
	const door = options.tasks?.door ?? null
	const bus = options.tasks ? createTaskEventBus(options.tasks.watch) : undefined
	const handler = createMcpHandler(
		() => {
			const server = new McpServer(options.server, { instructions: options.instructions })
			registerMcpTools(server, options.capability, options.catalogue.operations, {
				client,
				tasks: door,
			})
			registerMcpTasks(server, door, { client })
			if (options.skills?.length) registerMcpSkills(server, options.skills)
			return server
		},
		{ responseMode: 'json', ...(bus ? { bus } : {}) },
	)
	return handler.fetch(request, {
		...(options.authInfo ? { authInfo: options.authInfo } : {}),
		...(body !== undefined ? { parsedBody: body } : {}),
	})
}

const routers = new WeakMap<ReportCatalogue, RestRouter>()

/** REST for a catalogue, built once per catalogue (its class's routes, its OpenAPI document, its reference page). */
export function reportRest(catalogue: ReportCatalogue, options: RestOptions): RestRouter {
	const kept = routers.get(catalogue)
	if (kept) return kept
	const router = restRouter(catalogue.operations, options)
	routers.set(catalogue, router)
	return router
}
