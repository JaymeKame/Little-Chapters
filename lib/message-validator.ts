/* Message validator following parent-sms.spec.md guidelines */

const NEVER_SAY_LIST = [
  'good progress',
  'doing well',
  'great job',
  'excellent',
  'amazing',
  'fantastic',
  'perfect',
  'awesome',
  'score',
  'percent',
  'grade',
  'level',
  'behind',
  'ahead',
  'better than',
  'worse than',
  'faster',
  'slower',
  'improving',
  'struggling',
  'failing',
  'passing',
];

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateParentMessage(message: string): ValidationResult {
  const errors: string[] = [];

  // Check for digits or percent signs
  if (/[0-9%]/.test(message)) {
    errors.push('Message contains digits or percent signs');
  }

  // Check for exclamation marks
  if (message.includes('!')) {
    errors.push('Message contains exclamation marks');
  }

  // Check for words from never_say list
  const lowerMessage = message.toLowerCase();
  for (const forbidden of NEVER_SAY_LIST) {
    if (lowerMessage.includes(forbidden)) {
      errors.push(`Message contains forbidden phrase: "${forbidden}"`);
    }
  }

  // Check for specific word naming (look for quoted words or word patterns)
  // The message should contain at least one specific word in quotes or mentioned
  const hasSpecificWord = /"[a-zA-Z]+"/.test(message) || /read [a-zA-Z]+ on their own/.test(message);
  if (!hasSpecificWord) {
    errors.push('Message does not name a specific word');
  }

  // Check for timeline normalisation (required in every message)
  const timelineIndicators = [
    'weeks to stick',
    'normal',
    'expected',
    'pace',
    'practice like this',
  ];
  const hasTimeline = timelineIndicators.some(indicator => lowerMessage.includes(indicator));
  if (!hasTimeline) {
    errors.push('Message is missing timeline normalisation');
  }

  // Check for negative content (even on mostly-assisted nights)
  const negativePatterns = [
    'didn\'t',
    'couldn\'t',
    'failed',
    'struggled',
    'had trouble',
    'was hard',
  ];
  const hasNegative = negativePatterns.some(pattern => lowerMessage.includes(pattern));
  if (hasNegative) {
    errors.push('Message contains negative content');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
