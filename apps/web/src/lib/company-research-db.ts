/**
 * Company Research Database Utilities
 * 
 * Functions for persisting and retrieving company research sessions,
 * findings, and contacts.
 * 
 * @server-only
 */

import "server-only";
import { creditPrisma } from "@esgcredit/db-credit";
import type { ResearchFinding, CompanyContact } from "./company-research-agent";

interface SaveResearchSessionParams {
  sessionId: string;
  userId: number | string;
  companyName: string;
  status: "in_progress" | "completed" | "failed";
}

interface UpdateResearchSessionParams {
  status: "in_progress" | "completed" | "failed";
  finalReport?: any;
  tokensUsed?: number;
  researchSummary?: string;
  completedAt?: Date;
  errorMessage?: string;
  findings?: ResearchFinding[];
  contacts?: CompanyContact[];
}

/**
 * Create a new research session
 */
export async function saveResearchSession(params: SaveResearchSessionParams) {
  const { sessionId, userId, companyName, status } = params;
  
  // Ensure userId is an integer
  const userIdInt = typeof userId === 'string' ? parseInt(userId, 10) : userId;

  try {
    return await creditPrisma.company_research_sessions.create({
      data: {
        session_id: sessionId,
        user_id: userIdInt,
        company_name: companyName,
        status,
        created_at: new Date(),
        updated_at: new Date(),
      },
    });
  } catch (error) {
    console.error("Failed to save research session:", error);
    throw error;
  }
}

/**
 * Update a research session with results
 */
export async function updateResearchSession(
  sessionId: string,
  params: UpdateResearchSessionParams
) {
  const { 
    status, 
    finalReport, 
    tokensUsed, 
    researchSummary, 
    completedAt,
    errorMessage,
    findings,
    contacts,
  } = params;

  try {
    // Update the main session
    const session = await creditPrisma.company_research_sessions.update({
      where: { session_id: sessionId },
      data: {
        status,
        final_report: finalReport,
        total_tokens_used: tokensUsed || 0,
        research_summary: researchSummary,
        completed_at: completedAt,
        error_message: errorMessage,
        updated_at: new Date(),
      },
    });

    // Save findings if provided
    if (findings && findings.length > 0) {
      await creditPrisma.research_findings.createMany({
        data: findings.map(finding => ({
          session_id: sessionId,
          finding_type: finding.type,
          title: finding.title,
          content: finding.content,
          source_url: finding.source_url,
          source_name: finding.source_name,
          confidence_score: finding.confidence_score,
          metadata: finding.metadata || {},
          created_at: new Date(),
        })),
      });
    }

    // Save contacts if provided
    if (contacts && contacts.length > 0) {
      // Get the company name from the session
      const sessionData = await creditPrisma.company_research_sessions.findUnique({
        where: { session_id: sessionId },
        select: { company_name: true },
      });

      await creditPrisma.company_contacts.createMany({
        data: contacts.map(contact => ({
          session_id: sessionId,
          company_name: sessionData?.company_name || "Unknown",
          full_name: contact.full_name,
          job_title: contact.job_title,
          department: contact.department,
          email: contact.email,
          phone: contact.phone,
          linkedin_url: contact.linkedin_url,
          source_url: contact.source_url,
          relevance_score: contact.relevance_score,
          metadata: {},
          created_at: new Date(),
        })),
      });
    }

    return session;
  } catch (error) {
    console.error("Failed to update research session:", error);
    throw error;
  }
}

/**
 * Get a specific research session with all related data
 */
export async function getResearchSession(sessionId: string) {
  try {
    const session = await creditPrisma.company_research_sessions.findUnique({
      where: { session_id: sessionId },
      include: {
        research_findings: true,
        company_contacts: true,
      },
    });

    if (!session) return null;

    return {
      id: session.id,
      sessionId: session.session_id,
      companyName: session.company_name,
      status: session.status,
      tokensUsed: session.total_tokens_used,
      costUsd: session.total_cost_usd,
      researchSummary: session.research_summary,
      finalReport: session.final_report,
      errorMessage: session.error_message,
      createdAt: session.created_at,
      updatedAt: session.updated_at,
      completedAt: session.completed_at,
      findings: session.research_findings.map(f => ({
        id: f.id,
        type: f.finding_type,
        title: f.title,
        content: f.content,
        sourceUrl: f.source_url,
        sourceName: f.source_name,
        confidenceScore: Number(f.confidence_score),
        metadata: f.metadata,
        createdAt: f.created_at,
      })),
      contacts: session.company_contacts.map(c => ({
        id: c.id,
        fullName: c.full_name,
        jobTitle: c.job_title,
        department: c.department,
        email: c.email,
        phone: c.phone,
        linkedinUrl: c.linkedin_url,
        sourceUrl: c.source_url,
        relevanceScore: Number(c.relevance_score),
        createdAt: c.created_at,
      })),
    };
  } catch (error) {
    console.error("Failed to get research session:", error);
    throw error;
  }
}

/**
 * Get research history for a user
 */
export async function getResearchHistory(userId: number | string, limit: number = 10) {
  // Ensure userId is an integer
  const userIdInt = typeof userId === 'string' ? parseInt(userId, 10) : userId;
  
  try {
    const sessions = await creditPrisma.company_research_sessions.findMany({
      where: { user_id: userIdInt },
      orderBy: { created_at: "desc" },
      take: limit,
      select: {
        id: true,
        session_id: true,
        company_name: true,
        status: true,
        total_tokens_used: true,
        research_summary: true,
        created_at: true,
        completed_at: true,
        _count: {
          select: {
            research_findings: true,
            company_contacts: true,
          },
        },
      },
    });

    return sessions.map(s => ({
      id: s.id,
      sessionId: s.session_id,
      companyName: s.company_name,
      status: s.status,
      tokensUsed: s.total_tokens_used,
      researchSummary: s.research_summary,
      createdAt: s.created_at,
      completedAt: s.completed_at,
      findingsCount: s._count.research_findings,
      contactsCount: s._count.company_contacts,
    }));
  } catch (error) {
    console.error("Failed to get research history:", error);
    throw error;
  }
}

/**
 * Search for contacts across all research sessions
 */
export async function searchContacts(
  query: string,
  options?: {
    department?: string;
    minRelevance?: number;
    limit?: number;
  }
) {
  try {
    const contacts = await creditPrisma.company_contacts.findMany({
      where: {
        OR: [
          { full_name: { contains: query, mode: "insensitive" } },
          { company_name: { contains: query, mode: "insensitive" } },
          { job_title: { contains: query, mode: "insensitive" } },
        ],
        ...(options?.department && { department: options.department }),
        ...(options?.minRelevance && { relevance_score: { gte: options.minRelevance } }),
      },
      orderBy: { relevance_score: "desc" },
      take: options?.limit || 20,
    });

    return contacts.map(c => ({
      id: c.id,
      companyName: c.company_name,
      fullName: c.full_name,
      jobTitle: c.job_title,
      department: c.department,
      email: c.email,
      phone: c.phone,
      linkedinUrl: c.linkedin_url,
      relevanceScore: Number(c.relevance_score),
    }));
  } catch (error) {
    console.error("Failed to search contacts:", error);
    throw error;
  }
}

/**
 * Get recent research findings by type
 */
export async function getRecentFindings(
  findingType: string,
  limit: number = 10
) {
  try {
    const findings = await creditPrisma.research_findings.findMany({
      where: { finding_type: findingType },
      orderBy: { created_at: "desc" },
      take: limit,
      include: {
        company_research_sessions: {
          select: { company_name: true },
        },
      },
    });

    return findings.map(f => ({
      id: f.id,
      companyName: f.company_research_sessions.company_name,
      type: f.finding_type,
      title: f.title,
      content: f.content,
      sourceUrl: f.source_url,
      confidenceScore: Number(f.confidence_score),
      createdAt: f.created_at,
    }));
  } catch (error) {
    console.error("Failed to get recent findings:", error);
    throw error;
  }
}

/**
 * Delete a research session and all related data
 */
export async function deleteResearchSession(sessionId: string) {
  try {
    // Cascade delete will handle findings and contacts
    await creditPrisma.company_research_sessions.delete({
      where: { session_id: sessionId },
    });
    return true;
  } catch (error) {
    console.error("Failed to delete research session:", error);
    throw error;
  }
}

/**
 * Get aggregate statistics for research
 */
export async function getResearchStats(userId?: number | string) {
  try {
    // Ensure userId is an integer if provided
    const userIdInt = userId ? (typeof userId === 'string' ? parseInt(userId, 10) : userId) : undefined;
    const where = userIdInt ? { user_id: userIdInt } : {};

    const [totalSessions, completedSessions, totalFindings, totalContacts] = await Promise.all([
      creditPrisma.company_research_sessions.count({ where }),
      creditPrisma.company_research_sessions.count({ 
        where: { ...where, status: "completed" } 
      }),
      creditPrisma.research_findings.count(),
      creditPrisma.company_contacts.count(),
    ]);

    const tokenStats = await creditPrisma.company_research_sessions.aggregate({
      where,
      _sum: { total_tokens_used: true },
      _avg: { total_tokens_used: true },
    });

    return {
      totalSessions,
      completedSessions,
      failedSessions: totalSessions - completedSessions,
      successRate: totalSessions > 0 ? (completedSessions / totalSessions) * 100 : 0,
      totalFindings,
      totalContacts,
      totalTokensUsed: tokenStats._sum.total_tokens_used || 0,
      avgTokensPerSession: Math.round(tokenStats._avg.total_tokens_used || 0),
    };
  } catch (error) {
    console.error("Failed to get research stats:", error);
    throw error;
  }
}
