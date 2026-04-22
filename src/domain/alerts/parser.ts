import { ParsedAlerts } from '../../types/alerts';

const ALERT_REGEX = /<ALERT>(.*?)<\/ALERT>/g;

export function parseAlertTags(text: string): ParsedAlerts {
  const alertIds: string[] = [];
  let match: RegExpExecArray | null;

  const regex = new RegExp(ALERT_REGEX.source, ALERT_REGEX.flags);
  while ((match = regex.exec(text)) !== null) {
    alertIds.push(match[1]);
  }

  const cleanText = text.replace(new RegExp(ALERT_REGEX.source, ALERT_REGEX.flags), '').trim();

  return { cleanText, alertIds };
}
