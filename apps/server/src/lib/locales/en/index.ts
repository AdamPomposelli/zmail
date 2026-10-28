import ai from './ai';
import mail from './mail';
import developer from './developer';
import rules from './rules';
import misc from './misc';

/** Every English translation of the engine, keyed by the French text. */
export default { ...ai, ...mail, ...developer, ...rules, ...misc } as Record<string, string>;
