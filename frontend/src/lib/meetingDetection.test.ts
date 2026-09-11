import { describe, expect, test } from 'bun:test';
import { detectMeetingApp } from './meetingDetection';

describe('detectMeetingApp', () => {
  test('recognizes supported native meeting applications', () => {
    expect(detectMeetingApp(['Music', 'zoom.us'])).toEqual({
      name: 'Zoom',
      detectedProcess: 'zoom.us',
    });
    expect(detectMeetingApp(['Microsoft Teams (work or school)'])?.name).toBe('Microsoft Teams');
    expect(detectMeetingApp(['Slack'])?.name).toBe('Slack Huddle');
  });

  test('ignores browsers and unrelated audio applications', () => {
    expect(detectMeetingApp(['Google Chrome', 'Safari', 'Music'])).toBeNull();
  });

  test('ignores empty process names', () => {
    expect(detectMeetingApp(['', '   '])).toBeNull();
  });
});
