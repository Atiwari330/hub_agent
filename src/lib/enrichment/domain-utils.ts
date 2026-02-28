/**
 * Domain Utilities for Enrichment Pipeline
 *
 * Extracts company domains from email addresses and filters out
 * free/personal email providers.
 */

/**
 * Extract the domain portion from an email address.
 * Returns null if the email is invalid.
 */
export function extractDomain(email: string): string | null {
  const trimmed = email.trim().toLowerCase();
  const atIndex = trimmed.lastIndexOf('@');
  if (atIndex < 1 || atIndex === trimmed.length - 1) return null;

  const domain = trimmed.slice(atIndex + 1);
  // Basic domain validation: at least one dot, no spaces
  if (!domain.includes('.') || domain.includes(' ')) return null;

  return domain;
}

/**
 * Check if a domain belongs to a free/personal email provider.
 * These domains don't represent a company website worth scraping.
 */
export function isFreeEmailProvider(domain: string): boolean {
  return FREE_EMAIL_PROVIDERS.has(domain.toLowerCase());
}

/**
 * Comprehensive list of free/personal email providers.
 * Covers major providers, regional services, and common disposable domains.
 */
export const FREE_EMAIL_PROVIDERS = new Set([
  // Major providers
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.uk',
  'yahoo.co.in',
  'yahoo.ca',
  'yahoo.com.au',
  'yahoo.fr',
  'yahoo.de',
  'yahoo.it',
  'yahoo.es',
  'yahoo.co.jp',
  'ymail.com',
  'hotmail.com',
  'hotmail.co.uk',
  'hotmail.fr',
  'hotmail.de',
  'hotmail.it',
  'hotmail.es',
  'outlook.com',
  'outlook.co.uk',
  'live.com',
  'live.co.uk',
  'msn.com',
  'aol.com',
  'aol.co.uk',
  'icloud.com',
  'me.com',
  'mac.com',
  'protonmail.com',
  'proton.me',
  'pm.me',
  'zoho.com',
  'zohomail.com',
  'mail.com',
  'email.com',
  'fastmail.com',
  'fastmail.fm',
  'tutanota.com',
  'tuta.com',
  'tuta.io',
  'hey.com',

  // ISP email
  'comcast.net',
  'verizon.net',
  'att.net',
  'sbcglobal.net',
  'bellsouth.net',
  'charter.net',
  'cox.net',
  'earthlink.net',
  'juno.com',
  'netzero.net',
  'windstream.net',
  'frontier.com',
  'centurylink.net',
  'optimum.net',
  'optonline.net',
  'roadrunner.com',
  'twc.com',

  // Regional / international
  'gmx.com',
  'gmx.de',
  'gmx.net',
  'web.de',
  't-online.de',
  'freenet.de',
  'mail.ru',
  'yandex.com',
  'yandex.ru',
  'qq.com',
  '163.com',
  '126.com',
  'sina.com',
  'rediffmail.com',
  'naver.com',
  'hanmail.net',
  'daum.net',
  'libero.it',
  'virgilio.it',
  'laposte.net',
  'orange.fr',
  'free.fr',
  'sfr.fr',
  'wanadoo.fr',
  'btinternet.com',
  'sky.com',
  'virginmedia.com',
  'ntlworld.com',
  'bigpond.com',
  'telus.net',
  'shaw.ca',
  'rogers.com',
  'sympatico.ca',
  'videotron.ca',

  // Disposable / temporary
  'guerrillamail.com',
  'mailinator.com',
  'tempmail.com',
  'throwaway.email',
  'sharklasers.com',
  'guerrillamailblock.com',
  'grr.la',
  'yopmail.com',
  'trashmail.com',
  'dispostable.com',
  'maildrop.cc',
  'getnada.com',
  'temp-mail.org',
]);
