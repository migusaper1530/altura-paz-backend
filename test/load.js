import http from 'k6/http';
import {check} from 'k6';
export const options={
  scenarios:{public_routes:{executor:'constant-arrival-rate',rate:Number(__ENV.RATE||1000),timeUnit:'1s',duration:__ENV.DURATION||'15s',preAllocatedVUs:30,maxVUs:200}},
  thresholds:{http_req_duration:['p(95)<200'],http_req_failed:['rate<0.01'],dropped_iterations:['count==0']}
};
export default function(){const res=http.get((__ENV.BASE_URL||'http://gateway:3000')+'/api/routes?limit=20');check(res,{'respuesta pública correcta':r=>r.status===200});}
