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
    expect(detectMeetingApp(['Google Chrome', 'Google Meet'])?.name).toBe('Google Meet');
  });

  test('ignores browsers and unrelated audio applications', () => {
    expect(detectMeetingApp(['Google Chrome', 'Safari', 'Music'])).toBeNull();
  });

  test('ignores empty process names', () => {
    expect(detectMeetingApp(['', '   '])).toBeNull();
  });

  test('recognizes messaging call apps', () => {
    expect(detectMeetingApp(['WhatsApp'])?.name).toBe('WhatsApp');
    expect(detectMeetingApp(['Telegram'])?.name).toBe('Telegram');
    expect(detectMeetingApp(['Signal'])?.name).toBe('Signal');
  });

  test('generic fallback flags unknown apps when allowed', () => {
    expect(detectMeetingApp(['SomeRandomApp'], { allowUnknown: true })).toEqual({
      name: 'SomeRandomApp',
      detectedProcess: 'SomeRandomApp',
      generic: true,
    });
  });

  test('generic fallback still ignores media and browser apps', () => {
    expect(detectMeetingApp(['Spotify'], { allowUnknown: true })).toBeNull();
    expect(detectMeetingApp(['Google Chrome'], { allowUnknown: true })).toBeNull();
    expect(detectMeetingApp(['Music'], { allowUnknown: true })).toBeNull();
  });

  test('prefers a known app over the generic fallback', () => {
    expect(detectMeetingApp(['SomeRandomApp', 'zoom.us'], { allowUnknown: true })?.name).toBe('Zoom');
  });
});
