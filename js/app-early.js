try{
  var ndStart=Date.UTC(2026,8,18,21,0,0), ndEnd=Date.UTC(2026,8,24,21,0,0), now=Date.now();
  var ndPreview=/^(localhost|127\.0\.0\.1)$/.test(location.hostname)&&/(^|[?&])nd=1(&|$)/.test(location.search);
  if(ndPreview||(now>=ndStart&&now<ndEnd))document.documentElement.setAttribute("data-event","nationalday")
}catch(e){}
window.ME_EARLY=fetch("/api/auth/me",{credentials:"same-origin",headers:{accept:"application/json"}}).catch(function(){return null})
