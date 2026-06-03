export interface LeadMagnet {
	category: string;
	description: string;
	id: string;
	leadMagnet: string;
	painLine: string;
	postLabel: string;
}

/**
 * Typed copy of the SuperRecruiter lead magnet library (extracted from
 * `linkedin-lead-magnet-SKILL.md.pdf`). `painLine` completes the sentence
 * "so you don't ___". IDs are stable, lowercase kebab-case, and AI selection
 * may only return values from this list.
 */
export const LEAD_MAGNETS = [
	{
		id: "claude-skills-pack",
		category: "Claude / AI Tools",
		leadMagnet: "11 Claude Skills Pack for Hiring",
		postLabel: "Claude skills pack",
		description: "an 11-skill Claude pack that recruits for you",
		painLine: "waste hours on manual sourcing",
	},
	{
		id: "recruiting-autopilot-playbook",
		category: "Claude / AI Tools",
		leadMagnet: "Recruiting Autopilot Playbook (12 Claude Tasks)",
		postLabel: "Recruiting autopilot playbook",
		description: "a 12-task Claude playbook that puts recruiting on autopilot",
		painLine: "touch the repetitive parts of hiring",
	},
	{
		id: "ai-outbound-stack",
		category: "Claude / AI Tools",
		leadMagnet: "AI-Powered Outbound Recruiting Stack",
		postLabel: "AI outbound stack",
		description: "an AI stack that sources candidates for you",
		painLine: "rely on job boards to find people",
	},
	{
		id: "3-agent-recruiting-team",
		category: "Claude / AI Tools",
		leadMagnet: "3-Agent Recruiting Team",
		postLabel: "3-agent recruiting team",
		description: "a 3-agent Claude team that runs recruiting in the background",
		painLine: "hire a recruiter to do the work",
	},
	{
		id: "ai-outbound-playbook",
		category: "Claude / AI Tools",
		leadMagnet: "AI Outbound Recruiting Playbook",
		postLabel: "AI outbound playbook",
		description: "a full AI recruiting system that fills roles for you",
		painLine: "post jobs and wait for applicants",
	},
	{
		id: "ai-hiring-strategist",
		category: "Claude / AI Tools",
		leadMagnet: "Hiring Strategist",
		postLabel: "AI hiring strategist",
		description: "an AI that builds your entire hiring strategy",
		painLine: "figure out the process from scratch",
	},
	{
		id: "application-filter-ai",
		category: "Claude / AI Tools",
		leadMagnet: "AI-Powered Candidate Application Filter",
		postLabel: "Application filter AI",
		description: "a Claude filter that screens every resume automatically",
		painLine: "read through hundreds of applications",
	},
	{
		id: "openclaw-sourcing-agent",
		category: "Claude / AI Tools",
		leadMagnet: "OpenClaw AI Agent",
		postLabel: "OpenClaw sourcing agent",
		description: "an AI agent that sources and contacts candidates on its own",
		painLine: "spend hours finding and reaching out",
	},
	{
		id: "ai-pitch-decks",
		category: "Claude / AI Tools",
		leadMagnet: "Claude + Gamma Candidate Pitch Decks",
		postLabel: "AI pitch decks",
		description: "a Claude workflow that builds candidate pitch decks for you",
		painLine: "lose great candidates because the role wasn't sold well",
	},
	{
		id: "claude-resume-prompts",
		category: "Claude / AI Tools",
		leadMagnet: "Super Recruiter's 10 Favorite Resume Prompts",
		postLabel: "Claude resume prompts",
		description: "10 Claude prompts that review resumes in seconds",
		painLine: "spend your day reading CVs",
	},
	{
		id: "candidate-conversion-templates",
		category: "Outreach & Messaging",
		leadMagnet: "Templates to Convert Candidate Interest",
		postLabel: "Candidate conversion templates",
		description:
			"a set of templates that turns candidate interest into booked interviews",
		painLine: "lose warm candidates to silence",
	},
	{
		id: "candidate-email-templates",
		category: "Outreach & Messaging",
		leadMagnet: "Email Templates (to candidates)",
		postLabel: "Candidate email templates",
		description: "email templates that actually get candidates to reply",
		painLine: "keep sending messages into the void",
	},
	{
		id: "linkedin-outreach-templates",
		category: "Outreach & Messaging",
		leadMagnet: "LinkedIn Templates (to candidates)",
		postLabel: "LinkedIn outreach templates",
		description: "LinkedIn messages that get candidates to respond",
		painLine: "waste InMail on messages that get ignored",
	},
	{
		id: "outreach-mistakes-guide",
		category: "Outreach & Messaging",
		leadMagnet: "Avoid These 10 Candidate Outreach Mistakes",
		postLabel: "Outreach mistakes guide",
		description:
			"a guide that fixes the outreach mistakes killing your response rate",
		painLine: "keep burning through candidates with the wrong approach",
	},
	{
		id: "candidate-closing-hacks",
		category: "Outreach & Messaging",
		leadMagnet: "5 Hacks That Close 95% of Candidates",
		postLabel: "Candidate closing hacks",
		description: "5 hacks that close almost every candidate you want",
		painLine: "keep losing people at the offer stage",
	},
	{
		id: "ultimate-hiring-playbook",
		category: "Sourcing & Pipeline",
		leadMagnet: "The Ultimate Hiring Playbook",
		postLabel: "Ultimate hiring playbook",
		description: "a full hiring system that fills any role without job boards",
		painLine: "depend on agencies or job postings",
	},
	{
		id: "startup-hiring-playbook",
		category: "Sourcing & Pipeline",
		leadMagnet: "The Ultimate Hiring Playbook (for startups)",
		postLabel: "Startup hiring playbook",
		description:
			"a startup hiring playbook that lets you build a team without agency fees",
		painLine: "burn budget on recruiters before you're ready",
	},
	{
		id: "100x-recruiting-stack",
		category: "Sourcing & Pipeline",
		leadMagnet: "100x Recruiting Stack",
		postLabel: "100x recruiting stack",
		description: "the exact tool stack that 100x's a recruiter's output",
		painLine: "hire more people to handle more roles",
	},
	{
		id: "agency-recruiting-stack",
		category: "Sourcing & Pipeline",
		leadMagnet: "100x Recruiter Stack (Agency Edition)",
		postLabel: "Agency recruiting stack",
		description: "an agency stack that 100x's output without adding headcount",
		painLine: "grow your team to grow your billings",
	},
	{
		id: "outbound-recruiting-infrastructure",
		category: "Sourcing & Pipeline",
		leadMagnet: "Outbound Recruitment Infrastructure",
		postLabel: "Outbound recruiting infrastructure",
		description:
			"an outbound system that delivers candidates without job board posts",
		painLine: "wait for inbound to fill your pipeline",
	},
	{
		id: "candidate-funnel-builder",
		category: "Sourcing & Pipeline",
		leadMagnet: "Outbound Candidate Funnel Builder",
		postLabel: "Candidate funnel builder",
		description: "a funnel that keeps candidates flowing in automatically",
		painLine: "start every search from zero",
	},
	{
		id: "no-job-board-system",
		category: "Sourcing & Pipeline",
		leadMagnet:
			"Book Interviews with High-Quality Candidates Not Scrolling Job Boards",
		postLabel: "No job board system",
		description:
			"a system for booking quality interviews without posting a single job",
		painLine: "rely on job boards to find the right people",
	},
	{
		id: "candidate-conversion-kit",
		category: "Conversion & Scheduling",
		leadMagnet: "Candidate Conversion Kit",
		postLabel: "Candidate conversion kit",
		description: "a kit that turns cold candidates into booked interviews",
		painLine: "lose people after the first message",
	},
	{
		id: "agency-conversion-kit",
		category: "Conversion & Scheduling",
		leadMagnet: "Candidate Conversion Kit (Agency Edition)",
		postLabel: "Agency conversion kit",
		description: "a kit that turns cold leads into client meetings",
		painLine: "chase prospects who go quiet",
	},
	{
		id: "scheduling-automation-tool",
		category: "Conversion & Scheduling",
		leadMagnet: "Candidate Scheduling Automation",
		postLabel: "Scheduling automation tool",
		description:
			"an automation that books interviews without you touching your calendar",
		painLine: "lose hours to back-and-forth scheduling",
	},
	{
		id: "interview-evaluation-guide",
		category: "Evaluation & Hiring Decisions",
		leadMagnet: "Evaluating & Interviewing Candidates",
		postLabel: "Interview evaluation guide",
		description:
			"a framework that stops bad hires before they get through the door",
		painLine: "keep making expensive hiring mistakes",
	},
	{
		id: "candidate-scorecard-template",
		category: "Evaluation & Hiring Decisions",
		leadMagnet: "Candidate Scorecard",
		postLabel: "Candidate scorecard template",
		description: "a scorecard that removes gut-feel from every hiring decision",
		painLine: "hire based on vibes and regret it later",
	},
	{
		id: "bad-hire-questions",
		category: "Evaluation & Hiring Decisions",
		leadMagnet: "Dodge Bad Hires with Must-Ask Interview Questions",
		postLabel: "Bad hire questions",
		description:
			"a list of questions that catch bad hires before you make an offer",
		painLine: "find out three months in that it was the wrong person",
	},
	{
		id: "candidate-decision-guide",
		category: "Evaluation & Hiring Decisions",
		leadMagnet: "15 Signs You Need to Make or Avoid a Candidate",
		postLabel: "Candidate decision guide",
		description:
			"a guide that tells you exactly who to hire and who to pass on",
		painLine: "waste time interviewing people you should have cut earlier",
	},
	{
		id: "hiring-process-checklist",
		category: "Evaluation & Hiring Decisions",
		leadMagnet: "Hiring Checklist",
		postLabel: "Hiring process checklist",
		description:
			"a checklist that stops the most common hiring mistakes before they happen",
		painLine: "keep repeating the same process problems",
	},
	{
		id: "cost-per-hire",
		category: "Metrics, Costs & Operations",
		leadMagnet: "Cost Per Hire Calculation Kit",
		postLabel: "Cost per hire",
		description:
			"a kit that shows you exactly where your hiring budget is leaking",
		painLine: "keep overspending without knowing where it's going",
	},
	{
		id: "hiring-audit-checklist",
		category: "Metrics, Costs & Operations",
		leadMagnet: "10 Warning Signs Your Hiring Process Is Bleeding Money",
		postLabel: "Hiring audit checklist",
		description:
			"an audit that spots where your hiring process is losing money",
		painLine: "keep paying for a broken process",
	},
	{
		id: "recruiting-metrics-guide",
		category: "Metrics, Costs & Operations",
		leadMagnet: "15 Recruiting Metrics You Need to Track",
		postLabel: "Recruiting metrics guide",
		description:
			"a guide to the 15 metrics that show where recruiting is breaking down",
		painLine: "fly blind when something in the pipeline goes wrong",
	},
	{
		id: "ai-recruiting-tools",
		category: "Metrics, Costs & Operations",
		leadMagnet: "AI Recruiting Tools",
		postLabel: "AI recruiting tools",
		description:
			"a breakdown of the AI tools top recruiters are actually using",
		painLine: "waste money on the wrong tech stack",
	},
	{
		id: "employee-retention-guide",
		category: "Retention & Culture",
		leadMagnet: "Employee Retention Guide",
		postLabel: "Employee retention guide",
		description: "a guide that stops your best people from quietly walking out",
		painLine: "lose great hires six months after you made them",
	},
	{
		id: "retention-tactics-guide",
		category: "Retention & Culture",
		leadMagnet: "5 Ways to Stop A Valued Employee From Leaving",
		postLabel: "Retention tactics guide",
		description:
			"5 tactics that keep your top performers from walking out the door",
		painLine: "restart the hiring process for a role you already filled",
	},
	{
		id: "disengagement-signal-guide",
		category: "Retention & Culture",
		leadMagnet: "10 Signs Your Employee Is Disengaged",
		postLabel: "Disengagement signal guide",
		description:
			"a guide that spots disengaged employees before they quietly quit",
		painLine: "find out they've been checked out for months",
	},
	{
		id: "30-60-90-plan",
		category: "Retention & Culture",
		leadMagnet: "30-60-90 Day Plan",
		postLabel: "30-60-90 plan",
		description: "a day-by-day plan that turns new hires into top performers",
		painLine:
			"lose people in the first 90 days after all that work to hire them",
	},
] as const satisfies readonly LeadMagnet[];

export type LeadMagnetId = (typeof LEAD_MAGNETS)[number]["id"];

const LEAD_MAGNETS_BY_ID: Record<string, LeadMagnet> = Object.fromEntries(
	LEAD_MAGNETS.map((magnet) => [magnet.id, magnet])
);

/** Look up a lead magnet by id. Returns `undefined` for unknown ids. */
export function getLeadMagnetById(id: string): LeadMagnet | undefined {
	return Object.hasOwn(LEAD_MAGNETS_BY_ID, id)
		? LEAD_MAGNETS_BY_ID[id]
		: undefined;
}

/** Whether an id maps to a known lead magnet. */
export function leadMagnetExists(id: string): boolean {
	return getLeadMagnetById(id) !== undefined;
}

export interface LeadMagnetSequenceIds {
	followUpOneLeadMagnetId: string;
	followUpTwoLeadMagnetId: string;
	targetedLeadMagnetId: string;
}

export interface ResolvedLeadMagnetSequence {
	followUpOne: LeadMagnet;
	followUpTwo: LeadMagnet;
	targeted: LeadMagnet;
}

/**
 * Resolve a 3-id sequence to lead magnets, enforcing the post-level invariants:
 * every id must exist in the library and all three must be distinct. Throws an
 * `Error` describing the violation otherwise.
 */
export function resolveLeadMagnetSequence(
	ids: LeadMagnetSequenceIds
): ResolvedLeadMagnetSequence {
	const targeted = getLeadMagnetById(ids.targetedLeadMagnetId);
	const followUpOne = getLeadMagnetById(ids.followUpOneLeadMagnetId);
	const followUpTwo = getLeadMagnetById(ids.followUpTwoLeadMagnetId);

	if (!(targeted && followUpOne && followUpTwo)) {
		const missing = [
			targeted ? null : ids.targetedLeadMagnetId,
			followUpOne ? null : ids.followUpOneLeadMagnetId,
			followUpTwo ? null : ids.followUpTwoLeadMagnetId,
		].filter((id): id is string => id !== null);

		throw new Error(`Unknown lead magnet id(s): ${missing.join(", ")}`);
	}

	const orderedIds = [targeted.id, followUpOne.id, followUpTwo.id];
	if (new Set(orderedIds).size !== orderedIds.length) {
		throw new Error(
			`Lead magnet ids must be distinct: ${orderedIds.join(", ")}`
		);
	}

	return { targeted, followUpOne, followUpTwo };
}
