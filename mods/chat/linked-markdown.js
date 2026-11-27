// Retained child views own their callbacks. A virtual-row renderer cannot register them.
import {View} from 'gpui-kit';
import {TextView} from 'gpui-base';
import {setShared} from 'herdr';
export default class LinkedMarkdown extends View {
 init(value){this.value=value;}
 update(value){this.value=value;}
 render(){
  const value=this.value;
  return TextView[value.format??"markdown"](value.id,value.text).scrollable(false).selectable(true).flex_none()
   .on_link_click((href)=>setShared('workspace.chat-link',{href,key:value.key,nonce:Math.random(),at:Date.now()}));
 }
}
