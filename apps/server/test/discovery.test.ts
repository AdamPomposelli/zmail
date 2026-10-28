import { describe, expect, it } from 'vitest';
import { discoverServers, parseAutoconfig, probe } from '../src/mail/discovery';

const ISPDB = `<?xml version="1.0"?><clientConfig version="1.1"><emailProvider id="example.test">
  <displayName>Example Mail</displayName>
  <incomingServer type="imap"><hostname>imap.example.test</hostname><port>993</port><socketType>SSL</socketType><username>%EMAILADDRESS%</username></incomingServer>
  <incomingServer type="pop3"><hostname>pop.example.test</hostname><port>995</port><socketType>SSL</socketType></incomingServer>
  <outgoingServer type="smtp"><hostname>smtp.example.test</hostname><port>587</port><socketType>STARTTLS</socketType><username>%EMAILLOCALPART%</username></outgoingServer>
</emailProvider></clientConfig>`;

describe('server autodiscovery', () => {
  it('reads a Mozilla autoconfig document', () => {
    expect(parseAutoconfig(ISPDB)).toEqual({
      name: 'Example Mail',
      imap: { host: 'imap.example.test', port: 993, secure: true, username: 'email' },
      smtp: { host: 'smtp.example.test', port: 587, secure: false, username: 'localpart' },
    });
  });

  it('knows public providers without any network lookup', async () => {
    const d = await discoverServers('someone@gmail.com');
    expect(d).toMatchObject({ found: true, presetId: 'gmail', source: 'preset', imap: { host: 'imap.gmail.com', port: 993 } });
  });

  it('probes a real IMAP greeting (local GreenMail) and rejects a closed port', async () => {
    expect(await probe('127.0.0.1', 3143, false)).toBe(true);
    expect(await probe('127.0.0.1', 1, false, 800)).toBe(false);
  });
});
