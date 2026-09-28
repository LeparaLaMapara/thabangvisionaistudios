import { permanentRedirect } from 'next/navigation';

/**
 * /creators/[id] is a creator's profile, but /creators itself was a 404: the
 * list of creators lives at /smart-creators. People (and search engines)
 * trimming a profile address land here, so send them to the list.
 */
export default function CreatorsIndex(): never {
  permanentRedirect('/smart-creators');
}
