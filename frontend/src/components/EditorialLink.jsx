/** Crawlable secondary navigation, retaining native modified-click behavior. */
export default function EditorialLink({href,onNavigate,children}) {
  return <a className="editorial-link" href={href} onClick={event=>{
    if(onNavigate && event.button===0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey){event.preventDefault();onNavigate();}
  }}>{children}</a>;
}
