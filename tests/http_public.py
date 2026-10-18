"""Pruebas de permisos públicos, sin credenciales privadas ni datos guardados localmente."""
import json
from urllib.request import Request, urlopen
from urllib.error import HTTPError

BASE = 'https://knzxdzuuklfpaplnzmev.supabase.co'
KEY = 'sb_publishable_HvavGm_Km0bMEH3F0AjfkA_fMs4fTMc'

def request(path, method='GET', body=None, headers=None):
    payload = json.dumps(body).encode() if body is not None else None
    req = Request(BASE+path, data=payload, method=method,
                  headers={'apikey':KEY, 'Content-Type':'application/json', **(headers or {})})
    try:
        with urlopen(req, timeout=20) as response:
            raw = response.read()
            return response.status, json.loads(raw) if raw else None
    except HTTPError as error:
        return error.code, json.loads(error.read())

def main():
    status, products = request('/rest/v1/products?select=id,name,price,quantity&order=sort_order&limit=200')
    assert status == 200 and len(products) >= 4, (status,products)
    assert [(p['quantity'],float(p['price'])) for p in products[:4]] == [(6,2),(8,2.5),(12,3.5),(20,5)]
    status, images = request('/rest/v1/catalog_images?select=id,url&limit=200')
    assert status == 200 and len(images)>=9
    for table, body in [
        ('products',{'name':'TEST NO AUTORIZADO','price':1,'quantity':1}),
        ('catalog_images',{'url':'https://example.invalid/test.jpg'}),
        ('combos',{'name':'TEST NO AUTORIZADO','price':1}),
        ('combo_items',{'combo_id':products[0]['id'],'product_id':products[0]['id'],'quantity':1}),
        ('site_settings',{'key':'hero','image_id':images[0]['id']})
    ]:
        status,_=request('/rest/v1/'+table,'POST',body)
        assert status in (401,403), (table,status)
    status,_=request('/rest/v1/products?id=eq.'+products[0]['id'],'PATCH',{'price':999})
    assert status in (401,403),status
    status,_=request('/rest/v1/products?id=eq.'+products[0]['id'],'DELETE')
    assert status in (401,403),status
    status,_=request('/rest/v1/rpc/save_combo','POST',{'p_id':None,'p_name':'TEST NO AUTORIZADO','p_description':'','p_price':1,'p_image_id':None,'p_active':True,'p_sort_order':0,'p_items':[]})
    assert status in (401,403),status
    status,_=request('/rest/v1/site_settings?key=eq.hero','PATCH',{'image_id':images[0]['id']})
    assert status in (401,403),status
    status,_=request('/rest/v1/setup_nonces?select=digest&limit=1')
    assert status==404,status
    print('OK: lectura real del catálogo; escrituras anónimas denegadas; configuración temporal eliminada.')

if __name__ == '__main__': main()
