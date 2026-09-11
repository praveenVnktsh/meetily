export interface DetectedMeetingApp {
  name: string;
  detectedProcess: string;
}

const MEETING_APP_PATTERNS: Array<{ name: string; patterns: RegExp[] }> = [
  { name: 'Google Meet', patterns: [/^google meet$/i] },
  { name: 'Zoom', patterns: [/\bzoom(?:\.us| workplace)?\b/i] },
  { name: 'Microsoft Teams', patterns: [/\bmicrosoft teams\b/i, /^teams$/i] },
  { name: 'Cisco Webex', patterns: [/\bwebex\b/i] },
  { name: 'Slack Huddle', patterns: [/^slack$/i] },
  { name: 'Discord', patterns: [/^discord$/i] },
  { name: 'FaceTime', patterns: [/^facetime$/i] },
  { name: 'Amazon Chime', patterns: [/\bamazon chime\b/i] },
  { name: 'GoTo Meeting', patterns: [/\bgotomeeting\b/i, /\bgo to meeting\b/i] },
  { name: 'BlueJeans', patterns: [/\bbluejeans\b/i] },
];

export function detectMeetingApp(processNames: string[]): DetectedMeetingApp | null {
  for (const processName of processNames) {
    const trimmedName = processName.trim();
    if (!trimmedName) continue;

    const match = MEETING_APP_PATTERNS.find(({ patterns }) =>
      patterns.some((pattern) => pattern.test(trimmedName))
    );
    if (match) {
      return { name: match.name, detectedProcess: trimmedName };
    }
  }

  return null;
}
