var e=Object.create,t=Object.defineProperty,n=Object.getOwnPropertyDescriptor,r=Object.getOwnPropertyNames,i=Object.getPrototypeOf,a=Object.prototype.hasOwnProperty,o=(e,i,o,s)=>{if(i&&typeof i==`object`||typeof i==`function`)for(var c=r(i),l=0,u=c.length,d;l<u;l++)d=c[l],!a.call(e,d)&&d!==o&&t(e,d,{get:(e=>i[e]).bind(null,d),enumerable:!(s=n(i,d))||s.enumerable});return e},s=(n,r,a)=>(a=n==null?{}:e(i(n)),o(r||!n||!n.__esModule?t(a,`default`,{value:n,enumerable:!0}):a,n));let c=require(`@reach/observe-rect`);c=s(c);function l(e,t){try{return new URL(e).origin===new URL(t).origin}catch{return!1}}var u=class e{static CSS_VAR_Z_INDEX=`--directus-visual-editing--overlay--z-index`;static CSS_VAR_BORDER_SPACING=`--directus-visual-editing--rect--border-spacing`;static CSS_VAR_BORDER_WIDTH=`--directus-visual-editing--rect--border-width`;static CSS_VAR_BORDER_COLOR=`--directus-visual-editing--rect--border-color`;static CSS_VAR_BORDER_RADIUS=`--directus-visual-editing--rect--border-radius`;static CSS_VAR_HOVER_OPACITY=`--directus-visual-editing--rect-hover--opacity`;static CSS_VAR_HIGHLIGHT_OPACITY=`--directus-visual-editing--rect-highlight--opacity`;static CSS_VAR_ACTIONS_GAP=`--directus-visual-editing--actions--gap`;static CSS_VAR_ACTIONS_OFFSET=`--directus-visual-editing--actions--offset`;static CSS_VAR_FOCUS_RING_COLOR=`--directus-visual-editing--actions--focus-ring-color`;static CSS_VAR_FOCUS_RING_WIDTH=`--directus-visual-editing--actions--focus-ring-width`;static CSS_VAR_FOCUS_RING_OFFSET=`--directus-visual-editing--actions--focus-ring-offset`;static CSS_VAR_BUTTON_WIDTH=`--directus-visual-editing--edit-btn--width`;static CSS_VAR_BUTTON_HEIGHT=`--directus-visual-editing--edit-btn--height`;static CSS_VAR_BUTTON_RADIUS=`--directus-visual-editing--edit-btn--radius`;static CSS_VAR_EDIT_BUTTON_BG_COLOR=`--directus-visual-editing--edit-btn--bg-color`;static CSS_VAR_EDIT_BUTTON_HOVER_BG_COLOR=`--directus-visual-editing--edit-btn-hover--bg-color`;static CSS_VAR_EDIT_BUTTON_ICON_BG_IMAGE=`--directus-visual-editing--edit-btn--icon-bg-image`;static CSS_VAR_EDIT_BUTTON_ICON_BG_SIZE=`--directus-visual-editing--edit-btn--icon-bg-size`;static CSS_VAR_AI_BUTTON_BG_COLOR=`--directus-visual-editing--ai-btn--bg-color`;static CSS_VAR_AI_BUTTON_HOVER_BG_COLOR=`--directus-visual-editing--ai-btn-hover--bg-color`;static CSS_VAR_AI_BUTTON_ICON_BG_IMAGE=`--directus-visual-editing--ai-btn--icon-bg-image`;static CSS_VAR_AI_BUTTON_ICON_BG_SIZE=`--directus-visual-editing--ai-btn--icon-bg-size`;static ICON_EDIT=`url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="%23ffffff"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M14.06 9.02l.92.92L5.92 19H5v-.92l9.06-9.06M17.66 3c-.25 0-.51.1-.7.29l-1.83 1.83 3.75 3.75 1.83-1.83c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.2-.2-.45-.29-.71-.29zm-3.6 3.19L3 17.25V21h3.75L17.81 9.94l-3.75-3.75z"/></svg>')`;static ICON_AI=`url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px"><path fill="%23ffffff" d="M10 14.175L11 12l2.175-1L11 10l-1-2.175L9 10l-2.175 1L9 12l1 2.175ZM10 19l-2.5-5.5L2 11l5.5-2.5L10 3l2.5 5.5L18 11l-5.5 2.5L10 19Zm8 2l-1.25-2.75L14 17l2.75-1.25L18 13l1.25 2.75L22 17l-2.75 1.25L18 21Zm-8-10Z"/></svg>')`;static OVERLAY_ID=`directus-visual-editing`;static STYLE_ID=`directus-visual-editing-style`;static CONTAINER_RECT_CLASS_NAME=`directus-visual-editing-overlay`;static RECT_CLASS_NAME=`directus-visual-editing-rect`;static RECT_HIGHLIGHT_CLASS_NAME=`directus-visual-editing-rect-highlight`;static RECT_HIGHLIGHT_ACTIVE_CLASS_NAME=`directus-visual-editing-rect-highlight-active`;static RECT_PARENT_HOVER_CLASS_NAME=`directus-visual-editing-rect-parent-hover`;static RECT_HOVER_CLASS_NAME=`directus-visual-editing-rect-hover`;static RECT_INNER_CLASS_NAME=`directus-visual-editing-rect-inner`;static RECT_BUTTON_CLASS_NAME=`directus-visual-editing-button`;static RECT_EDIT_BUTTON_CLASS_NAME=`directus-visual-editing-edit-button`;static RECT_AI_BUTTON_CLASS_NAME=`directus-visual-editing-ai-button`;static RECT_ACTIONS_FLIPPED_CLASS_NAME=`directus-visual-editing-actions-flipped`;static getGlobalOverlay(){let t=document.getElementById(e.OVERLAY_ID);if(t)return t;let n=document.createElement(`div`);return n.id=e.OVERLAY_ID,document.body.insertAdjacentElement(`afterend`,n),n}static addStyles(){if(document.getElementById(e.STYLE_ID))return;let t=document.createElement(`style`);t.id=e.STYLE_ID;let n=new m().getTheme(),r={primaryColor:n?.primaryColor?.trim()||`#6644ff`,primaryAccentColor:n?.primaryAccentColor?.trim()||`color-mix(in srgb, #6644ff, #2e3C43 25%)`,borderRadius:n?.borderRadius?.trim()||`6px`,buttonSize:n?.buttonSize?.trim()||`24px`,focusRingWidth:n?.focusRingWidth?.trim()||`2px`,focusRingOffset:n?.focusRingOffset?.trim()||`2px`},i=`var(${e.CSS_VAR_ACTIONS_GAP}, 4px)`,a=`var(${e.CSS_VAR_ACTIONS_OFFSET}, 4px)`,o=`var(${e.CSS_VAR_EDIT_BUTTON_BG_COLOR}, ${r.primaryColor})`,s=`var(${e.CSS_VAR_AI_BUTTON_BG_COLOR}, ${r.primaryColor})`,c=`var(${e.CSS_VAR_EDIT_BUTTON_HOVER_BG_COLOR}, ${r.primaryAccentColor})`,l=`var(${e.CSS_VAR_AI_BUTTON_HOVER_BG_COLOR}, ${r.primaryAccentColor})`,u=`var(${e.CSS_VAR_BUTTON_WIDTH}, ${r.buttonSize})`,d=`var(${e.CSS_VAR_BUTTON_HEIGHT}, ${r.buttonSize})`,f=`var(${e.CSS_VAR_BUTTON_RADIUS}, ${r.borderRadius})`,p=`var(${e.CSS_VAR_BORDER_SPACING}, 8px)`,h=`var(${e.CSS_VAR_BORDER_WIDTH}, ${r.focusRingWidth})`,g=`var(${e.CSS_VAR_BORDER_COLOR}, ${r.primaryColor})`,_=`var(${e.CSS_VAR_BORDER_RADIUS}, ${r.borderRadius})`,v=`var(${e.CSS_VAR_FOCUS_RING_COLOR}, ${r.primaryColor})`,y=`var(${e.CSS_VAR_FOCUS_RING_WIDTH}, ${r.focusRingWidth})`,b=`var(${e.CSS_VAR_FOCUS_RING_OFFSET}, ${r.focusRingOffset})`;t.appendChild(document.createTextNode(`
				#${e.OVERLAY_ID} {
					display: contents;
				}
				.${e.CONTAINER_RECT_CLASS_NAME} {
					pointer-events: none;
					position: fixed;
					inset: 0;
					z-index: var(${e.CSS_VAR_Z_INDEX}, 999999999);
				}
				.${e.RECT_CLASS_NAME} {
					position: absolute;
					/* Use non-logical properties to correctly position the rect with transform translate in RTL mode */
					top: 0;
					left: 0;
				}
				.${e.RECT_INNER_CLASS_NAME} {
					position: absolute;
					box-sizing: border-box;
					inset-block-start: calc(-1 * ${p});
					inset-inline-start: calc(-1 * ${p});
					inset-inline-end: calc(-1 * ${p});
					inset-block-end: calc(-1 * ${p});
					border: ${h} solid ${g};
					border-radius: ${_};
					opacity: 0;
				}
				.${e.RECT_CLASS_NAME}.${e.RECT_HOVER_CLASS_NAME} .${e.RECT_INNER_CLASS_NAME} {
					--hover-opacity: var(${e.CSS_VAR_HOVER_OPACITY}, 0.333);
					opacity: var(--hover-opacity);
				}
				.${e.RECT_CLASS_NAME}.${e.RECT_PARENT_HOVER_CLASS_NAME} .${e.RECT_INNER_CLASS_NAME} {
					opacity: calc(var(--hover-opacity) / 3);
				}
				.${e.RECT_HIGHLIGHT_CLASS_NAME} {
					pointer-events: all;
					cursor: pointer;
				}
				.${e.RECT_HIGHLIGHT_CLASS_NAME} .${e.RECT_INNER_CLASS_NAME}  {
					opacity: var(${e.CSS_VAR_HIGHLIGHT_OPACITY}, 0.333);
				}
				.${e.RECT_BUTTON_CLASS_NAME}:visited,
				.${e.RECT_BUTTON_CLASS_NAME}:active,
				.${e.RECT_BUTTON_CLASS_NAME}:hover,
				.${e.RECT_BUTTON_CLASS_NAME}:focus,
				.${e.RECT_BUTTON_CLASS_NAME} {
					all: initial;
					pointer-events: all;
					cursor: pointer;
					position: absolute;
					z-index: 1;
					inset-block-end: 100%;
					margin-block-end: calc((${p} + ${a}));
					inline-size: ${u};
					block-size: ${d};
					border-radius: ${f};
					background-position: center;
					background-repeat: no-repeat;
					opacity: 0;
				}
				.${e.RECT_BUTTON_CLASS_NAME}::after {
					content: '';
					position: absolute;
					inset-inline: calc(-1 * ${i} / 2);
					inset-block-start: 0;
					inset-block-end: calc(-1 * ${a});
				}
				.${e.RECT_BUTTON_CLASS_NAME}.${e.RECT_EDIT_BUTTON_CLASS_NAME} {
					inset-inline-start: calc(-1 * ${p});
					background-color: ${o};
					background-image: var(${e.CSS_VAR_EDIT_BUTTON_ICON_BG_IMAGE}, ${e.ICON_EDIT});
					background-size: var(${e.CSS_VAR_EDIT_BUTTON_ICON_BG_SIZE}, 66.6%);
				}
				.${e.RECT_BUTTON_CLASS_NAME}.${e.RECT_AI_BUTTON_CLASS_NAME} {
					inset-inline-start: calc(-1 * ${p} + ${u} + ${i});
					background-color: ${s};
					background-image: var(${e.CSS_VAR_AI_BUTTON_ICON_BG_IMAGE}, ${e.ICON_AI});
					background-size: var(${e.CSS_VAR_AI_BUTTON_ICON_BG_SIZE}, 66.6%);
				}
				.${e.RECT_CLASS_NAME}.${e.RECT_HOVER_CLASS_NAME}:not(.${e.RECT_PARENT_HOVER_CLASS_NAME}) .${e.RECT_BUTTON_CLASS_NAME},
				.${e.RECT_HIGHLIGHT_ACTIVE_CLASS_NAME} .${e.RECT_INNER_CLASS_NAME},
				.${e.RECT_HIGHLIGHT_CLASS_NAME}:hover .${e.RECT_BUTTON_CLASS_NAME},
				.${e.RECT_BUTTON_CLASS_NAME}:hover,
				.${e.RECT_BUTTON_CLASS_NAME}:hover ~ .${e.RECT_INNER_CLASS_NAME},
				.${e.RECT_HIGHLIGHT_CLASS_NAME}:hover .${e.RECT_INNER_CLASS_NAME},
				.${e.RECT_CLASS_NAME}:has(.${e.RECT_BUTTON_CLASS_NAME}:hover) .${e.RECT_BUTTON_CLASS_NAME},
				.${e.RECT_HIGHLIGHT_CLASS_NAME}:focus-within .${e.RECT_BUTTON_CLASS_NAME},
				.${e.RECT_BUTTON_CLASS_NAME}:focus-visible,
				.${e.RECT_BUTTON_CLASS_NAME}:focus-visible ~ .${e.RECT_INNER_CLASS_NAME},
				.${e.RECT_HIGHLIGHT_CLASS_NAME}:focus-within .${e.RECT_INNER_CLASS_NAME},
				.${e.RECT_CLASS_NAME}:has(.${e.RECT_BUTTON_CLASS_NAME}:focus-within) .${e.RECT_BUTTON_CLASS_NAME}  {
					opacity: 1;
				}
				.${e.RECT_BUTTON_CLASS_NAME}.${e.RECT_EDIT_BUTTON_CLASS_NAME}:hover {
					background-color: ${c};
				}
				.${e.RECT_BUTTON_CLASS_NAME}.${e.RECT_AI_BUTTON_CLASS_NAME}:hover {
					background-color: ${l};
				}
				.${e.RECT_CLASS_NAME}.${e.RECT_ACTIONS_FLIPPED_CLASS_NAME} .${e.RECT_BUTTON_CLASS_NAME} {
					inset-block-end: auto;
					inset-block-start: 100%;
					margin-block-start: calc(${p} + ${a});
				}
				.${e.RECT_CLASS_NAME}.${e.RECT_ACTIONS_FLIPPED_CLASS_NAME} .${e.RECT_BUTTON_CLASS_NAME}::after {
					inset-block-start: calc(-1 * ${a});
					inset-block-end: 0;
				}
				.${e.RECT_BUTTON_CLASS_NAME}:focus-visible {
					outline: ${y} solid ${v};
					outline-offset: ${b};
				}
			`)),document.head.appendChild(t)}},d=class e{static NEAR_TOP_THRESHOLD=54;hasNoDimensions=!1;element;container;editButton;aiButton;constructor(){this.container=this.createContainer(),this.element=this.createElement(),this.editButton=this.createEditButton();let e=new m;this.aiButton=e.isAiEnabled()?this.createAiButton():null,this.setMessages(e.getMessages()),this.createRectElement(),u.getGlobalOverlay().appendChild(this.container),p.highlightOverlayElements&&this.toggleHighlight(!0),this.element.addEventListener(`click`,e=>{let t=e.target;t&&(this.editButton.contains(t)||this.aiButton?.contains(t))||this.editButton.click()})}createContainer(){let e=document.createElement(`div`);return e.classList.add(u.CONTAINER_RECT_CLASS_NAME),e}createElement(){let e=document.createElement(`div`);return e.classList.add(u.RECT_CLASS_NAME),this.container.appendChild(e),e}createRectElement(){let e=document.createElement(`div`);e.classList.add(u.RECT_INNER_CLASS_NAME),this.element.appendChild(e)}createEditButton(){let e=document.createElement(`button`);return e.type=`button`,e.classList.add(u.RECT_BUTTON_CLASS_NAME),e.classList.add(u.RECT_EDIT_BUTTON_CLASS_NAME),this.element.appendChild(e),e}createAiButton(){let e=document.createElement(`button`);return e.type=`button`,e.classList.add(u.RECT_BUTTON_CLASS_NAME),e.classList.add(u.RECT_AI_BUTTON_CLASS_NAME),this.element.appendChild(e),e}setMessages(e){e&&(this.editButton.title=e.edit,this.editButton.setAttribute(`aria-label`,e.edit),this.aiButton&&(this.aiButton.title=e.addToContext,this.aiButton.setAttribute(`aria-label`,e.addToContext)))}updateRect(t){let n=t.width!==0&&t.height!==0;if(!this.hasNoDimensions&&!n){this.hasNoDimensions=!0,this.disable();return}this.hasNoDimensions&&n&&(this.hasNoDimensions=!1,this.enable()),this.element.style.width=`${t.width}px`,this.element.style.height=`${t.height}px`,this.element.style.transform=`translate(${t.left}px,${t.top}px)`,this.element.classList.toggle(u.RECT_ACTIONS_FLIPPED_CLASS_NAME,t.top<e.NEAR_TOP_THRESHOLD)}setCustomClass(e){e!==void 0&&/^[a-zA-Z_][\w-]*$/.test(e)&&this.container.classList.add(e)}toggleHover(e){this.element.classList.toggle(u.RECT_HOVER_CLASS_NAME,e)}toggleParentHover(e){this.element.classList.toggle(u.RECT_PARENT_HOVER_CLASS_NAME,e)}toggleHighlight(e){this.element.classList.toggle(u.RECT_HIGHLIGHT_CLASS_NAME,e)}toggleHighlightActive(e){this.element.classList.toggle(u.RECT_HIGHLIGHT_ACTIVE_CLASS_NAME,e)}disable(){this.element.style.display=`none`}enable(){this.element.style.removeProperty(`display`)}remove(){this.container.remove()}},f=class e{static DATASET=`directus`;static DATA_ATTRIBUTE_VALID_KEYS=[`collection`,`item`,`fields`,`mode`];activated=!1;optionsWritable=!0;customClass=void 0;element;key;editConfig;rectObserver;overlayElement;rect;hover=!1;disabled=!1;onSaved=void 0;boundMouseenter;boundMouseleave;constructor(t){this.element=t,this.key=crypto.randomUUID(),this.editConfig=e.editAttrToObject(this.element.dataset[e.DATASET])}activate(){this.activated||(this.activated=!0,this.boundMouseenter=this.onMouseenter.bind(this),this.boundMouseleave=this.onMouseleave.bind(this),this.element.addEventListener(`mouseenter`,this.boundMouseenter),this.element.addEventListener(`mouseleave`,this.boundMouseleave),this.rect=this.element.getBoundingClientRect(),this.overlayElement=new d,this.overlayElement.setCustomClass(this.customClass),this.overlayElement.updateRect(this.rect),this.overlayElement.editButton.addEventListener(`click`,this.onClickEdit.bind(this)),this.overlayElement.aiButton?.addEventListener(`click`,this.onClickAddToContext.bind(this)),this.rectObserver=(0,c.default)(this.element,this.onObserveRect.bind(this)),this.rectObserver.observe())}static query(t){return t?(Array.isArray(t)?t:[t]).filter(e=>e instanceof HTMLElement).flatMap(t=>t.dataset[e.DATASET]===void 0?Array.from(t.querySelectorAll(`[data-${e.DATASET}]`)):t).filter(e=>e!==null):Array.from(document.querySelectorAll(`[data-${e.DATASET}]`))}static objectToEditAttr(t){let n=[];for(let[r,i]of Object.entries(t))e.validEditConfigKey(r)&&(r===`fields`&&Array.isArray(i)?n.push(`${r}:${i.join(`,`)}`):n.push(`${r}:${i}`));return n.join(`;`)}static editAttrToObject(t){let n=t.split(`;`),r={};return n.forEach(t=>{let n=t.split(`:`);if(n[0]===void 0||n?.[1]===void 0)return;let i=n[0].trim();if(!e.validEditConfigKey(i))return;let a=n[1];if(i===`fields`){r.fields=a.split(`,`).map(e=>e.trim());return}r[i]=a.trim()}),r}static validEditConfigKey(t){return e.DATA_ATTRIBUTE_VALID_KEYS.includes(t)}applyOptions({customClass:e,onSaved:t},n=!1){this.optionsWritable&&(n&&(this.optionsWritable=!1),t!==void 0&&(this.onSaved=t),this.overlayElement?this.overlayElement.setCustomClass(e):this.customClass=e)}removeHoverListener(){this.boundMouseenter&&(this.element.removeEventListener(`mouseenter`,this.boundMouseenter),this.element.removeEventListener(`mouseleave`,this.boundMouseleave))}onClickEdit(){new m().send(`edit`,{key:this.key,editConfig:this.editConfig,rect:this.rect})}onClickAddToContext(e){e.stopPropagation(),new m().send(`addToContext`,{key:this.key,editConfig:this.editConfig,rect:this.rect})}onMouseenter(e){this.toggleItemHover(!0,e)}onMouseleave(e){this.toggleItemHover(!1,e)}toggleItemHover(e,t){this.element!==t.currentTarget||this.hover===e||(this.hover=e,this.setParentsHover(),this.overlayElement.toggleHover(e))}setParentsHover(){let e=p.getHoveredItems();e.forEach(t=>{let n=e.filter(e=>e.element!==t.element).some(e=>t.element.contains(e.element));t.overlayElement.toggleParentHover(n)})}onObserveRect(e){this.disabled||(this.rect=e,this.overlayElement?.updateRect(e))}},p=class e{static items=[];static highlightOverlayElements=!1;static highlightedKey=null;static getItem(t){return e.items.find(e=>e.element===t)}static getItemByKey(t){return e.items.find(e=>e.key===t)}static getItemByEditConfig(t,n,r){return e.items.find(e=>{if(e.editConfig.collection!==t||String(e.editConfig.item)!==String(n))return!1;let i=e.editConfig.fields??[],a=r??[];return i.length===a.length?i.every(e=>a.includes(e)):!1})}static getHoveredItems(){return e.items.filter(e=>e.hover)}static addItem(t){e.items.push(t)}static activateItems(t){e.items.forEach(e=>{t.includes(e.key)&&e.activate()})}static enableItems(t){(t??e.items).forEach(e=>{e.disabled=!1,e.rectObserver?.observe(),e.overlayElement?.enable()})}static disableItems(t){let n=t??e.items.filter(e=>!e.disabled);return n.forEach(e=>{e.disabled=!0,e.hover=!1,e.rectObserver?.unobserve(),e.overlayElement?.disable()}),[...n]}static removeItems(t){let n=t??e.items;n.forEach(e=>{e.rectObserver?.unobserve(),e.overlayElement?.remove(),e.removeHoverListener()}),e.items=e.items.filter(e=>!n.includes(e))}static highlightItems(t){this.highlightOverlayElements!==t&&(this.highlightOverlayElements=t,e.items.forEach(e=>{e.overlayElement?.toggleHighlight(t)}))}static highlightElement(t){if(this.highlightedKey!==null&&e.getItemByKey(this.highlightedKey)?.overlayElement?.toggleHighlightActive(!1),t===null){this.highlightedKey=null;return}let n;n=`key`in t?e.getItemByKey(t.key):e.getItemByEditConfig(t.collection,t.item,t.fields),n?(this.highlightedKey=n.key,n.overlayElement?.toggleHighlightActive(!0)):this.highlightedKey=null}},m=class e{static SINGLETON;static ERROR_PARENT_NOT_FOUND=`Error sending message to Directus in parent frame:`;origin=null;confirmed=!1;aiEnabled=!1;theme=null;messages=null;constructor(){if(e.SINGLETON)return e.SINGLETON;e.SINGLETON=this,window?.addEventListener(`message`,this.receive.bind(this))}isAiEnabled(){return this.aiEnabled}getTheme(){return this.theme}getMessages(){return this.messages}send(t,n){try{if(!this.origin)throw Error();return window.parent.postMessage({action:t,data:n},this.origin),!0}catch(t){return console.error(e.ERROR_PARENT_NOT_FOUND,t),!1}}connect(e){return this.origin=e,this.send(`connect`)}receive(e){if(!this.origin||!l(e.origin,this.origin))return;let{action:t,data:n}=e.data;t===`confirm`&&this.receiveConfirmAction(n),t===`activateElements`&&this.receiveActivateElements(n),t===`showEditableElements`&&this.receiveShowEditableElements(n),t===`saved`&&this.receiveSaved(n),t===`highlightElement`&&this.receiveHighlightElement(n)}receiveConfirm(){let e=0;return new Promise(t=>{let n=()=>{if(e>=10)return t(!1);e++,this.confirmed?t(!0):setTimeout(n,100)};n()})}receiveConfirmAction(e){let t=e;this.confirmed=!0,this.aiEnabled=!!t?.aiEnabled,this.theme=t?.theme??null,this.messages=t?.messages??null}receiveActivateElements(e){let t=Array.isArray(e)?e:[];p.activateItems(t)}receiveShowEditableElements(e){let t=!!e;p.highlightItems(t)}receiveSaved(e){let{key:t=``,collection:n=``,item:r=null,payload:i={}}=e,a=p.getItemByKey(t);if(a&&n&&typeof a.onSaved==`function`){a.onSaved({collection:n,item:r,payload:i});return}window.location.reload()}receiveHighlightElement(e){if(!e||typeof e!=`object`){p.highlightElement(null);return}let{key:t,collection:n,item:r,fields:i}=e;t===null?p.highlightElement(null):n&&r!==void 0?p.highlightElement(i?{collection:n,item:r,fields:i}:{collection:n,item:r}):typeof t==`string`&&p.highlightElement({key:t})}},h=class e{static navigationInitialized=!1;static onNavigation(t){if(e.navigationInitialized)return;let n=``,r=``,i,a=e=>{clearTimeout(i),i=setTimeout(e,100)},o=()=>{let e=window.location.href,i=document.title,s=n!==e||r!==i;s&&(a(()=>t({url:e,title:i})),n=e,r=i),setTimeout(o,s?50:200)};o(),e.navigationInitialized=!0}};async function g({directusUrl:e,elements:t=void 0,customClass:n=void 0,onSaved:r=void 0}){let i=new m;if(!i.connect(e)||!await i.receiveConfirm())return;h.onNavigation(e=>i.send(`navigation`,e)),u.addStyles();let a=f.query(t),o=[],s=[];return a.forEach(e=>{let i=p.getItem(e),a=i??new f(e);a.applyOptions({customClass:n,onSaved:r},!!t),o.push(a),i||(p.addItem(a),s.push({key:a.key,collection:a.editConfig.collection,item:a.editConfig.item,fields:a.editConfig.fields??[]}))}),s.length&&i.send(`checkFieldAccess`,s),{remove(){p.removeItems(o)},enable(){p.enableItems(o)},disable(){p.disableItems(o)}}}function _(){p.removeItems()}function v(){let e=p.disableItems();return{enable(){p.enableItems(e)}}}function y(e){return f.objectToEditAttr(e)}exports.apply=g,exports.disable=v,exports.remove=_,exports.setAttr=y;
//# sourceMappingURL=index.cjs.map