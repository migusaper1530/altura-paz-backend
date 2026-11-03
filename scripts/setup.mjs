import {randomBytes} from 'node:crypto';
import {existsSync,writeFileSync,readFileSync} from 'node:fs';
if(existsSync('.env')){console.log('.env ya existe; se conserva.');process.exit(0);}
const random=()=>randomBytes(24).toString('hex');
writeFileSync('.env',`DB_PASSWORD=${random()}\nJWT_SECRET=${random()}\nVISIT_SECRET=${random()}\nADMIN_EMAIL=admin@example.test\nADMIN_PASSWORD=${random()}\n`,{mode:0o600});
console.log('Configuración local creada. La contraseña de administración está en .env. No publiques ese archivo.');
