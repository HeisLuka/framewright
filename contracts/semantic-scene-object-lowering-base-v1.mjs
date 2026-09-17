export const q=v=>Math.round(v*1e6)/1e6;
export const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function h32(...xs){let h=2166136261>>>0;for(const x of xs)for(const c of `${x}|`){h^=c.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}return h>>>0;}
export const unit=(...x)=>h32(...x)/0xffffffff;
export const signed=(...x)=>unit(...x)*2-1;
export const rect=(x,y,w,h,part,i=0)=>({primitive:'rect',x:q(x),y:q(y),w:q(w),h:q(h),semantic_part:part,instance_index:i});
export const bar=(x,y,w,h,part,i=0)=>({primitive:'bar',x:q(x),y:q(y),w:q(w),h:q(h),semantic_part:part,instance_index:i});
export const line=(x1,y1,x2,y2,width,part,i=0)=>({primitive:'line',x1:q(x1),y1:q(y1),x2:q(x2),y2:q(y2),width:q(width),semantic_part:part,instance_index:i});
export const circle=(cx,cy,r,part,i=0)=>({primitive:'circle',cx:q(cx),cy:q(cy),r:q(r),semantic_part:part,instance_index:i});
export function person(x,y,s,i=0){return[circle(x,y-95*s,30*s,'head',i),line(x,y-62*s,x,y+55*s,18*s,'torso',i),line(x,y-20*s,x-55*s,y+20*s,12*s,'arm',i*2),line(x,y-20*s,x+55*s,y+20*s,12*s,'arm',i*2+1),line(x,y+55*s,x-40*s,y+130*s,14*s,'leg',i*2),line(x,y+55*s,x+40*s,y+130*s,14*s,'leg',i*2+1)];}
