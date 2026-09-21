// Independent Node/OpenSSL peer for the device's hardware-v1 interoperability test.
import {generateKeyPairSync,createPublicKey,diffieHellman,createHash,hkdfSync,createHmac,createCipheriv,randomBytes} from 'node:crypto';
let input='';for await(const chunk of process.stdin) input+=chunk;
const {publicKey:clientPublic,deviceInfo}=JSON.parse(input);
const pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
const desktopPublic=pair.publicKey.export({type:'spki',format:'der'}).toString('base64url');
const response={requestId:'pair-test',pollToken:'poll-test',protocolVersion:3,desktopEphemeralPublicKey:desktopPublic,
 certificateFingerprint:'AB'.repeat(32),identity:{endpointUuid:'desktop-test',desktopName:'Astra test'},
 hardware:{profile:'hardware-v1',deviceName:'Astra Thing',clientLabel:'Astra Thing',requestedScopes:['observe','playback-control','library-search'],...(deviceInfo?{deviceInfo}:{})}};
const transcript=Buffer.from(JSON.stringify([3,'pair-test',clientPublic,desktopPublic,response.certificateFingerprint,'desktop-test',38402,'hardware-v1','Astra Thing','Astra Thing',response.hardware.requestedScopes,...(deviceInfo?[[deviceInfo.modelId,deviceInfo.softwareVersion]]:[])]));
const secret=diffieHellman({privateKey:pair.privateKey,publicKey:createPublicKey({key:Buffer.from(clientPublic,'base64url'),type:'spki',format:'der'})});
const key=Buffer.from(hkdfSync('sha256',secret,createHash('sha256').update(transcript).digest(),Buffer.from('astra-phone-remote-v3-pairing'),32));
const code=String(createHmac('sha256',key).update('astra-phone-remote-v3-code').update(transcript).digest().readUInt32BE(0)%1000000).padStart(6,'0');
const proof=createHmac('sha256',key).update('astra-phone-remote-v3-proof').update(transcript).digest('base64url');
const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce);
cipher.setAAD(Buffer.concat([Buffer.from('astra-phone-remote-v3-confirm:'),createHash('sha256').update(transcript).digest()]));
const ciphertext=Buffer.concat([cipher.update(JSON.stringify({controlToken:'fixture-only-not-a-real-credential',syncToken:null,deviceId:'fixture'})),cipher.final()]);
console.log(JSON.stringify({response,code,proof,sealed:{nonce:nonce.toString('base64url'),ciphertext:ciphertext.toString('base64url'),authTag:cipher.getAuthTag().toString('base64url')}}));
