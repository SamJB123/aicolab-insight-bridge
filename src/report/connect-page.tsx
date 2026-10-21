/**
 * Connect — how to give an agent the whole record, for every Insight Bridge
 * report: the connector URL, how each assistant adds it, how to read what
 * comes back, and a console that calls the live server exactly as an agent
 * would.
 *
 * The console asks the report's own endpoint for `tools/list` and builds
 * every form from the tools' input schemas: the groups are the server's
 * (`toolGroup`), the starting values its declared examples. So the tool list
 * exists once, in the server, and this page can never describe a tool the
 * server does not answer.
 *
 * Signing in is the host's: a public report needs none; a signed-in one hands
 * the page its OAuth client details to show. What only one corpus can say —
 * a source that is partly unreadable, a tree with one generation — the host
 * adds to the reading notes.
 *
 * Moved from the pipeline's ConnectView and ConnectGuides (2026-10-21), with
 * Training Data's console.
 */
import {
	Accordion,
	AccordionItem,
	Button,
	Eyebrow,
	Field,
	NumberInput,
	SelectControl,
	TextInput,
} from '@aicolab/ui-solid'
import type { JSX } from '@solidjs/web'
import { createEffect, createSignal, For, onSettled, Show } from 'solid-js'
import {
	type ConsoleTool,
	groupTools,
	type InputSchema,
	initialValue,
	listTools,
	mcpRequest,
	resultText,
	type ToolResult,
	toolArguments,
} from '../mcp-tools.ts'
import { type ReportSurface, ReportSurfaceProvider, useReportSurface } from './surface.tsx'
import './report.css'

/** The OAuth clients the account service registered for this report's connector. */
export interface ConnectClients {
	claude: { clientId: string }
	chatgpt: { clientId: string }
	desktop: { clientId: string; callbackPort: number }
}

/** Copilot Studio's confidential client: its secret is shown once, when it is minted. */
export interface CopilotClient {
	clientId: string
	clientSecret: string | null
	authorizeUrl: string
	tokenUrl: string
	resource: string
}

/** Who may connect, and — when it takes signing in — where the page gets the client details. */
export type ConnectAccess =
	| { kind: 'public' }
	| {
			kind: 'signed-in'
			/** Who may sign in: 'signed-in portal users', 'members of this hive'. */
			audience: string
			clients: () => Promise<ConnectClients>
			copilot: () => Promise<CopilotClient>
	  }

/** What only the host can add to its Connect page, each a lazy slot. */
export interface ConnectAdditions {
	/** More reading notes, each an `<li>`: what only this corpus can say. */
	notes?: () => JSX.Element
}

export function ConnectPage(props: {
	/** The report's MCP endpoint, as a path on this origin: '/mcp', '/mcp/<run>'. */
	endpoint: string
	/** The name an assistant lists the server under: 'insightbridge-aph-ai'. */
	serverName: string
	access: ConnectAccess
	surface: ReportSurface
	additions?: ConnectAdditions
}) {
	return (
		<ReportSurfaceProvider surface={props.surface}>
			<ConnectBody
				endpoint={props.endpoint}
				serverName={props.serverName}
				access={props.access}
				additions={props.additions}
			/>
		</ReportSurfaceProvider>
	)
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

function ConnectBody(props: {
	endpoint: string
	serverName: string
	access: ConnectAccess
	additions: ConnectAdditions | undefined
}) {
	const s = useReportSurface()
	const nouns = () => s.words.nouns
	const lensHeading = () => {
		const lens = s.words.lens
		return lens ? (s.words.facets[lens]?.heading ?? lens) : null
	}
	const [origin, setOrigin] = createSignal('')
	const url = () => `${origin()}${props.endpoint}`
	const [tools, setTools] = createSignal<ConsoleTool[]>([])
	const [loading, setLoading] = createSignal(true)
	const [loadError, setLoadError] = createSignal<string | null>(null)
	let rpcId = 0
	let discovery: AbortController | undefined
	const load = async (endpoint: string) => {
		discovery?.abort()
		const controller = new AbortController()
		discovery = controller
		setLoading(true)
		setLoadError(null)
		try {
			const listed = await listTools(endpoint, () => ++rpcId, controller.signal)
			if (!controller.signal.aborted) setTools(listed)
		} catch (e) {
			if (!controller.signal.aborted) setLoadError(message(e))
		} finally {
			if (!controller.signal.aborted) setLoading(false)
		}
	}
	createEffect(
		() => props.endpoint,
		(endpoint) => {
			setOrigin(window.location.origin)
			void load(endpoint)
			return () => discovery?.abort()
		},
	)

	return (
		<div class="view-wrap">
			<header class="view-head">
				<Eyebrow>§ MCP · Model Context Protocol</Eyebrow>
				<h1 class="view-title">Give an agent the whole record</h1>
				<p class="view-stand">
					Every number and quote on these pages comes from a live query, and the same record is open
					to AI agents through a Model Context Protocol server
					<Show when={tools().length}> ({tools().length} read-only tools)</Show>. Add it as a
					connector and your agent can search every passage, read every topic and every{' '}
					{nouns().entity}
					<Show when={lensHeading()}>
						{(heading) => <>, compare what each {heading().toLowerCase()} says</>}
					</Show>{' '}
					and follow every claim to its {nouns().document}.
				</p>
			</header>

			<section class="sec" style={{ 'border-top': 'none' }}>
				<h2 class="sec-h">Add it as a connector</h2>
				<div class="ib-report-mcp-connect">
					<CopyLine label="Connector URL" value={url()} />
					<Show
						when={props.access.kind === 'signed-in' ? props.access : null}
						fallback={<p class="fig-note">This report is public: no authentication is required.</p>}
					>
						{(access) => (
							<p class="fig-note">
								This report is shared with {access().audience}. Sign in through AI CoLab and
								authorise the connector; access is checked on every request, and each person
								connects with their own account.
							</p>
						)}
					</Show>
					<ConnectGuides url={url()} serverName={props.serverName} access={props.access} />
					<p class="ib-report-mcp-try">
						Then ask:{' '}
						<em>
							“Using {s.words.title}, which topics have the widest reach, where do{' '}
							{nouns().entities} differ, and what verbatim quotes support their positions?”
						</em>
					</p>
					<p class="fig-note">
						Transport: Streamable HTTP, stateless JSON-RPC over <code>POST {props.endpoint}</code>.
						The endpoint answers each request with JSON and keeps no SSE stream open.
					</p>
				</div>
			</section>

			<section class="sec">
				<h2 class="sec-h">How to read what comes back</h2>
				<ul class="ib-report-mcp-steps">
					<li>
						<strong>Counts describe this record.</strong> These are the {nouns().entities} who chose
						to write; "N {nouns().entities} say X" measures the record, never a wider population.
					</li>
					<Show when={s.words.scale.order.length}>
						<li>
							<strong>Positions are relative to each topic's own proposition.</strong>{' '}
							{s.words.scale.order.join(', ')} measure a stance toward one framing, not agreement
							with the report or with each other.
						</li>
					</Show>
					<Show when={lensHeading()}>
						{(heading) => (
							<li>
								<strong>One lens: {heading()}.</strong> Perspectives compare what each value of it
								says; the tools that take it list its values.
							</li>
						)}
					</Show>
					<li>
						<strong>Use the ids the tools return.</strong> <code>topic_id</code> is the{' '}
						<code>topicClusterId</code> a topic tool returns; {nouns().entity} and{' '}
						{nouns().document} tools return the ids their detail tools take.
					</li>
					<Show when={props.additions?.notes}>{(notes) => <>{notes()()}</>}</Show>
				</ul>
			</section>

			<section class="sec">
				<h2 class="sec-h">Try the tools</h2>
				<p class="sec-sub">
					Choose a tool, adjust its inputs and call the live server: the exact request an agent
					makes. The tools, their inputs and their example values come from the server itself.
				</p>
				<Show when={loading()}>
					<p class="fig-note" role="status">
						Loading the tools…
					</p>
				</Show>
				<Show when={loadError()}>
					{(error) => (
						<div role="alert">
							<pre class="ib-report-mcp-pre ib-report-mcp-pre-err">{error()}</pre>
							<Button variant="outline" onClick={() => void load(props.endpoint)}>
								Retry loading the tools
							</Button>
						</div>
					)}
				</Show>
				<Show when={!loading() && !loadError() && !tools().length}>
					<p class="fig-note">This server lists no tools.</p>
				</Show>
				<Show when={tools().length}>
					<ToolConsole tools={tools()} endpoint={props.endpoint} nextId={() => ++rpcId} />
				</Show>
			</section>
		</div>
	)
}

/** The tool list beside the runner: pick one, fill its inputs, run it. */
function ToolConsole(props: { tools: ConsoleTool[]; endpoint: string; nextId: () => number }) {
	// the chosen tool (the first until the reader picks) and the reader's edits to its inputs over its examples
	const [selected, setSelected] = createSignal<string | null>(null)
	const tool = () => props.tools.find((t) => t.name === selected()) ?? props.tools[0]
	const fields = () => Object.entries(tool()?.inputSchema.properties ?? {})
	const required = (name: string) => tool()?.inputSchema.required?.includes(name) ?? false
	const initial = (t: ConsoleTool | undefined) =>
		Object.fromEntries(
			Object.entries(t?.inputSchema.properties ?? {}).map(([name, schema]) => [
				name,
				initialValue(schema),
			]),
		)
	const [edits, setEdits] = createSignal<Record<string, string> | null>(null)
	const values = () => edits() ?? initial(tool())
	const [busy, setBusy] = createSignal(false)
	const [result, setResult] = createSignal<string | null>(null)
	const [error, setError] = createSignal<string | null>(null)
	const [sent, setSent] = createSignal<string | null>(null)
	let pending: AbortController | undefined
	let revision = 0
	onSettled(() => () => pending?.abort())

	const select = (t: ConsoleTool) => {
		revision++
		pending?.abort()
		setBusy(false)
		setSelected(t.name)
		setEdits(null)
		setSent(null)
		setResult(null)
		setError(null)
	}
	const update = (name: string, value: string) => {
		setEdits({ ...values(), [name]: value })
		setSent(null)
		setResult(null)
		setError(null)
	}
	const request = () => {
		const t = tool()
		if (!t) return { params: null, error: 'Choose a tool.' }
		try {
			return { params: { name: t.name, arguments: toolArguments(t, values()) }, error: null }
		} catch (e) {
			return { params: null, error: message(e) }
		}
	}
	const envelope = (id: number, params: Record<string, unknown>) =>
		JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params }, null, 2)
	const preview = () => {
		const r = request()
		return sent() ?? (r.params ? envelope(0, r.params) : r.error)
	}
	const run = async () => {
		const r = request()
		if (!r.params) {
			setError(r.error)
			return
		}
		pending?.abort()
		const controller = new AbortController()
		pending = controller
		const version = ++revision
		const id = props.nextId()
		setSent(envelope(id, r.params))
		setBusy(true)
		setError(null)
		setResult(null)
		try {
			const response = await mcpRequest<ToolResult>(
				props.endpoint,
				id,
				'tools/call',
				r.params,
				controller.signal,
			)
			if (version !== revision) return
			const text = resultText(response)
			if (response.isError) setError(text)
			else setResult(text)
		} catch (e) {
			if (version === revision && !controller.signal.aborted) setError(message(e))
		} finally {
			if (version === revision) setBusy(false)
		}
	}

	return (
		<div class="ib-report-mcp-tester">
			<nav class="ib-report-mcp-toollist" aria-label="MCP tools">
				<For each={groupTools(props.tools)}>
					{(group) => (
						<div>
							<Show when={group.title}>
								{(title) => <h3 class="ib-report-mcp-group-h">{title()}</h3>}
							</Show>
							<For each={group.tools}>
								{(t) => (
									<button
										type="button"
										class={[
											'ib-report-mcp-tool',
											{ 'ib-report-mcp-tool-on': selected() === t.name },
										]}
										aria-pressed={selected() === t.name ? 'true' : 'false'}
										onClick={() => select(t)}
									>
										<span class="ib-report-mcp-tool-n">{t.name}</span>
										<span class="ib-report-mcp-tool-d">{t.title ?? t.description}</span>
									</button>
								)}
							</For>
						</div>
					)}
				</For>
			</nav>
			<div class="ib-report-mcp-runner">
				<form
					onSubmit={(e) => {
						e.preventDefault()
						void run()
					}}
				>
					<div class="ib-report-mcp-runner-h">
						<code class="ib-report-mcp-runner-name">{tool()?.name}</code>
						<Button type="submit" disabled={busy()}>
							{busy() ? 'Running…' : 'Run ▶'}
						</Button>
					</div>
					<Show when={tool()?.description}>
						{(description) => <p class="fig-note">{description()}</p>}
					</Show>
					<Show when={fields().length} fallback={<p class="fig-note">No inputs: just run it.</p>}>
						<div class="ib-report-mcp-fields">
							<For each={fields()}>
								{([name, schema]) => (
									<ToolField
										name={name}
										schema={schema}
										required={required(name)}
										value={values()[name] ?? ''}
										disabled={busy()}
										onInput={(value) => update(name, value)}
									/>
								)}
							</For>
						</div>
					</Show>
				</form>
				<div class="ib-report-mcp-req-h">POST {props.endpoint}</div>
				<pre class="ib-report-mcp-pre ib-report-mcp-pre-req">{preview()}</pre>
				<div aria-live="polite" aria-busy={busy() ? 'true' : 'false'}>
					<div class="ib-report-mcp-req-h">Response</div>
					<Show when={error()}>
						{(text) => (
							<pre role="alert" class="ib-report-mcp-pre ib-report-mcp-pre-err">
								{text()}
							</pre>
						)}
					</Show>
					<Show when={result()}>{(text) => <pre class="ib-report-mcp-pre">{text()}</pre>}</Show>
					<Show when={!result() && !error()}>
						<p class="fig-note">
							{busy() ? 'Calling the live server…' : 'Run a tool to see its output.'}
						</p>
					</Show>
				</div>
			</div>
		</div>
	)
}

/** One input, drawn by its schema: a choice for an enum or a boolean, a number, else text. */
function ToolField(props: {
	name: string
	schema: InputSchema
	required: boolean
	value: string
	disabled: boolean
	onInput: (value: string) => void
}) {
	const label = () => `${props.name.replaceAll('_', ' ')}${props.required ? ' *' : ''}`
	const options = () =>
		props.schema.enum?.map(String) ?? (props.schema.type === 'boolean' ? ['true', 'false'] : null)
	const numeric = () => props.schema.type === 'integer' || props.schema.type === 'number'
	return (
		<Field label={label()} hint={props.schema.description}>
			<Show
				when={options()}
				fallback={
					<Show
						when={numeric()}
						fallback={
							<TextInput
								value={props.value}
								disabled={props.disabled}
								required={props.required}
								placeholder={
									props.schema.type === 'array' || props.schema.type === 'object'
										? 'JSON'
										: undefined
								}
								onInput={(e) => props.onInput(e.currentTarget.value)}
							/>
						}
					>
						<NumberInput
							value={props.value}
							disabled={props.disabled}
							required={props.required}
							step={props.schema.type === 'integer' ? 1 : 'any'}
							min={props.schema.minimum}
							max={props.schema.maximum}
							onInput={(e) => props.onInput(e.currentTarget.value)}
						/>
					</Show>
				}
			>
				{(choices) => (
					<SelectControl
						value={props.value}
						disabled={props.disabled}
						required={props.required}
						onChange={(e) => props.onInput(e.currentTarget.value)}
					>
						<option value="">{props.required ? 'Choose a value' : 'Server default'}</option>
						<For each={choices()}>{(option) => <option value={option}>{option}</option>}</For>
					</SelectControl>
				)}
			</Show>
		</Field>
	)
}

/** A value to paste somewhere, with its label and a copy button. */
function CopyLine(props: { label: string; value: string }) {
	const [copied, setCopied] = createSignal(false)
	const [failed, setFailed] = createSignal(false)
	let timer: ReturnType<typeof setTimeout> | undefined
	onSettled(() => () => {
		if (timer) clearTimeout(timer)
	})
	const copy = async () => {
		try {
			await navigator.clipboard.writeText(props.value)
			setCopied(true)
			setFailed(false)
			if (timer) clearTimeout(timer)
			timer = setTimeout(() => setCopied(false), 1600)
		} catch {
			setFailed(true)
		}
	}
	return (
		<div class="ib-report-mcp-copy">
			<span class="ib-report-mcp-label">{props.label}</span>
			<code class="ib-report-mcp-value">{props.value}</code>
			<Button variant="outline" onClick={() => void copy()}>
				{copied() ? 'Copied ✓' : 'Copy'}
			</Button>
			<Show when={failed()}>
				<span class="fig-note" role="status">
					The clipboard was blocked: select the value to copy it.
				</span>
			</Show>
		</div>
	)
}

/** How each assistant adds the connector; with signing in, the client ids it asks for. */
function ConnectGuides(props: { url: string; serverName: string; access: ConnectAccess }) {
	const signedIn = () => (props.access.kind === 'signed-in' ? props.access : null)
	const [clients, setClients] = createSignal<ConnectClients | null>(null)
	const [clientsError, setClientsError] = createSignal<string | null>(null)
	const [copilot, setCopilot] = createSignal<CopilotClient | null>(null)
	const [copilotError, setCopilotError] = createSignal<string | null>(null)
	const [copilotBusy, setCopilotBusy] = createSignal(false)
	let generation = 0
	const loadClients = async () => {
		const access = signedIn()
		if (!access) return
		const version = ++generation
		setClientsError(null)
		try {
			const loaded = await access.clients()
			if (version === generation) setClients(loaded)
		} catch (e) {
			if (version === generation) setClientsError(message(e))
		}
	}
	createEffect(signedIn, (access) => {
		generation++
		setClients(null)
		setCopilot(null)
		if (access) void loadClients()
		return () => {
			generation++
		}
	})
	const showCopilot = async () => {
		const access = signedIn()
		if (!access) return
		const version = generation
		setCopilotBusy(true)
		setCopilotError(null)
		try {
			const loaded = await access.copilot()
			if (version === generation) setCopilot(loaded)
		} catch (e) {
			if (version === generation) setCopilotError(message(e))
		} finally {
			if (version === generation) setCopilotBusy(false)
		}
	}
	const clientId = (kind: 'claude' | 'chatgpt') => (
		<Show when={signedIn() && clients()}>
			{(c) => <CopyLine label="OAuth client ID" value={c()[kind].clientId} />}
		</Show>
	)
	const command = () => {
		const c = clients()
		const auth =
			signedIn() && c
				? ` --client-id ${c.desktop.clientId} --callback-port ${c.desktop.callbackPort}`
				: ''
		return `claude mcp add --transport http${auth} ${props.serverName} ${props.url}`
	}

	return (
		<>
			<Show when={clientsError()}>
				{(error) => (
					<p class="fig-note" role="alert">
						{error()}{' '}
						<Button variant="outline" onClick={() => void loadClients()}>
							Retry
						</Button>
					</p>
				)}
			</Show>
			<Accordion class="ib-report-mcp-clients" exclusive={false} spacing="separated">
				<AccordionItem summary="Claude — personal accounts (Free, Pro and Max)" open>
					<ol class="ib-report-mcp-steps">
						<li>
							Open{' '}
							<a href="https://claude.ai/customize/connectors" target="_blank" rel="noreferrer">
								Customize → Connectors
							</a>
							.
						</li>
						<li>
							Click <strong>+</strong>, then <strong>Add custom connector</strong>; name it and
							paste the URL above.
						</li>
						<li>
							<Show
								when={signedIn()}
								fallback={
									<>
										Leave <em>Advanced settings</em> empty and click <strong>Add</strong>.
									</>
								}
							>
								Open <strong>Advanced settings</strong>, paste the OAuth client ID below and leave
								the secret blank. Click <strong>Add</strong>, then sign in to AI CoLab and approve
								access.
							</Show>
						</li>
						<li>
							In a chat, click <strong>+</strong>, open <strong>Connectors</strong> and switch it on
							for that conversation.
						</li>
					</ol>
					{clientId('claude')}
					<p class="fig-note">
						Connectors are account-wide: added once, there in Claude on the web, desktop and mobile.{' '}
						<a
							href="https://support.claude.com/en/articles/11176164-use-connectors-to-extend-claude-s-capabilities"
							target="_blank"
							rel="noreferrer"
						>
							Claude's connector guide →
						</a>
					</p>
				</AccordionItem>
				<AccordionItem summary="Claude — organisation accounts (Team and Enterprise)">
					<p class="fig-note">
						On Team and Enterprise plans only an organisation owner can add a custom connector;
						members do not see the option.
					</p>
					<ol class="ib-report-mcp-steps">
						<li>
							An owner opens{' '}
							<a
								href="https://claude.ai/admin-settings/connectors"
								target="_blank"
								rel="noreferrer"
							>
								Organisation settings → Connectors
							</a>{' '}
							and adds a custom web connector with the URL above.
						</li>
						<li>
							<Show
								when={signedIn()}
								fallback={<>No authentication is required for this public report.</>}
							>
								Under <strong>Advanced settings</strong>, use the same Claude client ID as for
								personal accounts, with no secret.
							</Show>
						</li>
						<li>
							Each member connects it from their own connector settings and switches it on in a
							chat.
							<Show when={signedIn()}> Each person signs in as themselves.</Show>
						</li>
					</ol>
					{clientId('claude')}
					<p class="fig-note">
						<a
							href="https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp"
							target="_blank"
							rel="noreferrer"
						>
							Custom connector administration →
						</a>
					</p>
				</AccordionItem>
				<AccordionItem summary="ChatGPT — custom MCP app">
					<ol class="ib-report-mcp-steps">
						<li>
							Turn on <strong>Developer mode</strong> in{' '}
							<strong>Settings → Apps → Advanced settings</strong>, where your plan offers it; a
							workspace may need an administrator.
						</li>
						<li>
							Open <strong>Apps → Create</strong> and enter the URL above.
						</li>
						<li>
							<Show
								when={signedIn()}
								fallback={
									<>
										Choose <strong>No authentication</strong>, scan the tools and create the app.
									</>
								}
							>
								Choose <strong>OAuth</strong>, paste the client ID below and leave the secret blank.
								Create the app, then sign in to AI CoLab and authorise access.
							</Show>
						</li>
						<li>Select the app in a conversation and ask about the record.</li>
					</ol>
					{clientId('chatgpt')}
					<p class="fig-note">
						<a
							href="https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt"
							target="_blank"
							rel="noreferrer"
						>
							OpenAI's setup guide →
						</a>
					</p>
				</AccordionItem>
				<AccordionItem summary="Microsoft 365 Copilot — via Copilot Studio">
					<ol class="ib-report-mcp-steps">
						<li>
							Open an agent in{' '}
							<a href="https://copilotstudio.microsoft.com/" target="_blank" rel="noreferrer">
								Copilot Studio
							</a>
							, then <strong>Tools → Add a tool → New tool → Model Context Protocol</strong>.
						</li>
						<li>
							Enter a name, a description of this record and the URL above.{' '}
							<Show
								when={signedIn()}
								fallback={
									<>
										Choose <strong>None</strong> for authentication.
									</>
								}
							>
								Choose <strong>OAuth 2.0 → Manual</strong> and enter the values below; the
								registered callback is <code>https://global.consent.azure-apim.net/redirect</code>.
							</Show>
						</li>
						<li>
							Create the connection and add it to the agent.
							<Show when={signedIn()}>
								{' '}
								When sharing the agent, require{' '}
								<strong>each user to provide their own connection</strong>.
							</Show>{' '}
							Test a question, then publish it.
						</li>
					</ol>
					<Show when={signedIn()}>
						<Show
							when={copilot()}
							fallback={
								<Button
									variant="outline"
									disabled={copilotBusy()}
									onClick={() => void showCopilot()}
								>
									{copilotBusy() ? 'Loading…' : 'Show the OAuth details for Copilot Studio'}
								</Button>
							}
						>
							{(c) => (
								<>
									<CopyLine label="Client ID" value={c().clientId} />
									<Show
										when={c().clientSecret}
										fallback={
											<p class="fig-note">
												The client secret was issued before and cannot be shown again: use the one
												you saved.
											</p>
										}
									>
										{(secret) => (
											<CopyLine label="Client secret — save it now; shown once" value={secret()} />
										)}
									</Show>
									<CopyLine label="Authorization URL" value={c().authorizeUrl} />
									<CopyLine label="Token / refresh URL" value={c().tokenUrl} />
									<CopyLine label="Resource / audience" value={c().resource} />
									<CopyLine label="Scopes" value="openid profile email offline_access" />
								</>
							)}
						</Show>
						<Show when={copilotError()}>
							{(error) => (
								<p class="fig-note" role="alert">
									{error()}
								</p>
							)}
						</Show>
					</Show>
					<p class="fig-note">
						<a
							href="https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-add-existing-server-to-agent"
							target="_blank"
							rel="noreferrer"
						>
							Microsoft's connection guide →
						</a>
					</p>
				</AccordionItem>
				<AccordionItem summary="Claude Code">
					<p class="fig-note">Add the report as a remote HTTP server:</p>
					<Show
						when={!signedIn() || clients()}
						fallback={<p class="fig-note">The command appears once the client details load.</p>}
					>
						<pre class="ib-report-mcp-pre">
							<code>{command()}</code>
						</pre>
					</Show>
					<p class="fig-note">
						Run <code>/mcp</code> in Claude Code to check the connection
						{signedIn() ? ' and sign in.' : '.'}{' '}
						<a href="https://code.claude.com/docs/en/mcp" target="_blank" rel="noreferrer">
							Claude Code's MCP guide →
						</a>
					</p>
				</AccordionItem>
			</Accordion>
		</>
	)
}
