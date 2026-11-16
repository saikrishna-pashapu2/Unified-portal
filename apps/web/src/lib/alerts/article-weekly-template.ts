import { safeDigestUrl, type WeeklyArticleItem } from "./article-weekly-policy";

function escape(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

export function renderArticleWeeklyEmail(input: {
  name: string;
  alertName: string;
  items: WeeklyArticleItem[];
  unavailableDomains?: string[];
}): { subject: string; text: string; html: string } {
  const subject = `${input.alertName.replace(/[\r\n]/g, ' ').slice(0, 200)} - Weekly Digest`;
  const human = input.items.filter(item => item.origin === 'human');
  const ai = input.items.filter(item => item.origin === 'ai');
  const text: string[] = [subject, '', `Hello ${input.name},`, ''];
  const sections: string[] = [];
  const unavailable = input.unavailableDomains?.length
    ? `${input.unavailableDomains.map(domain => domain === 'esg' ? 'ESG' : 'Credit').join(' and ')} content was temporarily unavailable when this digest was prepared.` : '';
  if (unavailable) text.push(unavailable, '');
  for (const [label, items] of [["Articles liked by users", human], ["AI picks for you", ai]] as const) {
    if (!items.length) continue;
    text.push(label, '');
    const cards = items.map(item => {
      const url = safeDigestUrl(item.url);
      const domain = item.domain === 'esg' ? 'ESG' : 'Credit';
      text.push(`${domain}: ${item.title}`, ...(item.reason ? [item.reason] : []), url ?? '', '');
      const title = escape(item.title);
      return `<article style="border-left:3px solid ${item.domain === 'esg' ? '#15803d' : '#1d4ed8'};padding:12px 16px;margin:16px 0;background:#f8fafc">
<p style="font-size:12px;color:#475569;margin:0 0 8px">${domain} · ${escape(item.source)} · ${escape(item.kind)}</p>
<h3 style="font-size:17px;margin:0 0 8px">${url ? `<a style="color:#0f172a" href="${escape(url)}">${title}</a>` : title}</h3>
${item.origin === 'ai' && item.reason ? `<p style="margin:0;color:#475569">${escape(item.reason)}</p>` : ''}
</article>`;
    }).join('');
    sections.push(`<section><h2 style="font-size:20px;margin:28px 0 12px">${label}</h2>${label === 'AI picks for you' ? '<p style="color:#475569">Shared AI selections based on articles liked by users across each domain.</p>' : ''}${cards}</section>`);
  }
  const empty = input.items.length ? '' : '<p>No articles met your digest criteria this week.</p>';
  if (!input.items.length) text.push('No articles met your digest criteria this week.');
  text.push('Manage AI picks separately on the ESG and Credit articles pages. Your email alert settings control delivery.');
  return {
    subject, text: text.join('\n'),
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(subject)}</title></head><body style="margin:0;background:#f1f5f9;color:#0f172a;font-family:Arial,sans-serif;line-height:1.6"><main style="max-width:640px;margin:24px auto;padding:28px;background:white"><h1 style="font-size:26px">${escape(input.alertName)}</h1><p>Hello ${escape(input.name)},</p>${unavailable ? `<p>${escape(unavailable)}</p>` : ''}${empty}${sections.join('')}<hr style="border:0;border-top:1px solid #e2e8f0;margin-top:28px"><p style="font-size:12px;color:#64748b">Manage AI picks separately on the ESG and Credit articles pages. Your email alert settings control delivery.</p></main></body></html>`,
  };
}
