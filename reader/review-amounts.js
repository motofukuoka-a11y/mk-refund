export const componentFields=[['ordinary','ordinary'],['limited_express','express'],['green','green']];
// Inactive components stay editable; only components in the selected product
// contribute to its total. Missing amounts never overwrite a known OCR total.
export function componentTotal(kind,values){
 if(!kind?.kinds?.length)return null;
 const amounts=kind.kinds.map(type=>values[type]);
 if(!amounts.every(value=>value!==''&&value!==null&&value!==undefined&&Number.isSafeInteger(Number(value))&&Number(value)>0))return null;
 const total=amounts.reduce((sum,value)=>sum+Number(value),0);return Number.isSafeInteger(total)?total:null;
}
