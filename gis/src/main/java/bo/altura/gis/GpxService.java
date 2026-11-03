package bo.altura.gis;

import java.io.StringReader;
import java.nio.charset.StandardCharsets;
import java.util.*;
import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilderFactory;
import org.w3c.dom.*;
import org.xml.sax.InputSource;
import org.springframework.stereotype.Service;

@Service
public class GpxService {
    public Map<String,Object> parse(String xml) {
        if(xml==null || xml.isBlank() || xml.getBytes(StandardCharsets.UTF_8).length>5*1024*1024)
            throw new IllegalArgumentException("El GPX debe contener entre 1 byte y 5 MB");
        try {
            var f=DocumentBuilderFactory.newInstance(); f.setNamespaceAware(true);
            f.setFeature("http://apache.org/xml/features/disallow-doctype-decl",true);
            f.setFeature("http://xml.org/sax/features/external-general-entities",false);
            f.setFeature("http://xml.org/sax/features/external-parameter-entities",false);
            f.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD,""); f.setAttribute(XMLConstants.ACCESS_EXTERNAL_SCHEMA,"");
            f.setXIncludeAware(false); f.setExpandEntityReferences(false);
            var doc=f.newDocumentBuilder().parse(new InputSource(new StringReader(xml)));
            if(!"gpx".equals(doc.getDocumentElement().getLocalName())) throw new IllegalArgumentException("Se requiere un documento GPX");
            String namespace=doc.getDocumentElement().getNamespaceURI();
            if(namespace!=null && !namespace.equals("http://www.topografix.com/GPX/1/1") && !namespace.equals("http://www.topografix.com/GPX/1/0"))
                throw new IllegalArgumentException("Namespace GPX no compatible");
            List<List<List<Double>>> segments=new ArrayList<>();
            var trackSegments=doc.getElementsByTagNameNS("*","trkseg");
            for(int i=0;i<trackSegments.getLength();i++) segments.add(points((Element)trackSegments.item(i),"trkpt"));
            if(segments.isEmpty()) {
                var routes=doc.getElementsByTagNameNS("*","rte");
                for(int i=0;i<routes.getLength();i++) segments.add(points((Element)routes.item(i),"rtept"));
            }
            if(segments.isEmpty() || segments.stream().anyMatch(s->s.size()<2)) throw new IllegalArgumentException("Cada segmento debe tener al menos dos puntos");
            int count=segments.stream().mapToInt(List::size).sum();
            if(count>100000) throw new IllegalArgumentException("Máximo 100000 puntos por archivo");
            double distance=0,up=0,down=0,minLon=180,minLat=90,maxLon=-180,maxLat=-90;
            boolean elevations=true;
            for(var segment:segments) {
                for(int i=0;i<segment.size();i++) {
                    var p=segment.get(i); minLon=Math.min(minLon,p.get(0)); maxLon=Math.max(maxLon,p.get(0));
                    minLat=Math.min(minLat,p.get(1)); maxLat=Math.max(maxLat,p.get(1));
                    elevations &= p.size()==3;
                    if(i>0) {
                        var prev=segment.get(i-1); distance+=haversine(prev,p);
                        if(prev.size()==3 && p.size()==3) { double delta=p.get(2)-prev.get(2); up+=Math.max(0,delta); down+=Math.max(0,-delta); }
                    }
                }
            }
            if(distance<=0) throw new IllegalArgumentException("El trazado no tiene longitud");
            // GeoJSON 2D uniforme; alturas se conservan como perfil separado, con null donde faltan.
            var geometry=new ArrayList<List<List<Double>>>();
            var elevationProfile=new ArrayList<List<Double>>();
            for(var segment:segments) {
                var coords=new ArrayList<List<Double>>(); var profile=new ArrayList<Double>();
                for(var p:segment) { coords.add(List.of(p.get(0),p.get(1))); profile.add(p.size()==3?p.get(2):null); }
                geometry.add(coords); elevationProfile.add(profile);
            }
            Map<String,Object> out=new LinkedHashMap<>();
            out.put("geometry",Map.of("type","MultiLineString","coordinates",geometry));
            out.put("distance_m",Math.round(distance*10.0)/10.0);
            out.put("ascent_m",elevations?Math.round(up*10.0)/10.0:null);
            out.put("descent_m",elevations?Math.round(down*10.0)/10.0:null);
            out.put("estimated_minutes",(int)Math.max(1,Math.ceil(distance/4000.0*60+(elevations?up/600.0*60:0))));
            out.put("elevation_source",elevations?"gpx_unverified":"unavailable");
            out.put("elevation_profile",elevationProfile); out.put("point_count",count);
            out.put("bbox",List.of(minLon,minLat,maxLon,maxLat));
            out.put("start",geometry.get(0).get(0)); var last=geometry.get(geometry.size()-1); out.put("end",last.get(last.size()-1));
            return out;
        } catch(IllegalArgumentException e) { throw e; }
        catch(Exception e) { throw new IllegalArgumentException("GPX inválido o XML no permitido"); }
    }
    private List<List<Double>> points(Element segment,String tag) {
        var nodes=segment.getElementsByTagNameNS("*",tag); var result=new ArrayList<List<Double>>();
        if(nodes.getLength()>100000) throw new IllegalArgumentException("Máximo 100000 puntos");
        for(int i=0;i<nodes.getLength();i++) {
            Element e=(Element)nodes.item(i); double lat=Double.parseDouble(e.getAttribute("lat")),lon=Double.parseDouble(e.getAttribute("lon"));
            if(!Double.isFinite(lat)||!Double.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180) throw new IllegalArgumentException("Coordenadas inválidas");
            // Área piloto configurable en la siguiente fase: rectángulo amplio de alrededores de La Paz.
            if(lon< -68.8||lon> -67.4||lat< -17.3||lat> -15.6) throw new IllegalArgumentException("Punto fuera del área piloto (-68.8,-17.3,-67.4,-15.6)");
            List<Double> p=new ArrayList<>(List.of(lon,lat)); var ele=e.getElementsByTagNameNS("*","ele");
            if(ele.getLength()>0) { double height=Double.parseDouble(ele.item(0).getTextContent());
                if(!Double.isFinite(height)||height< -500||height>9000) throw new IllegalArgumentException("Elevación inválida"); p.add(height); }
            result.add(p);
        } return result;
    }
    static double haversine(List<Double>a,List<Double>b) {
        double la=Math.toRadians(a.get(1)),lb=Math.toRadians(b.get(1));
        double u=Math.sin((lb-la)/2),v=Math.sin(Math.toRadians(b.get(0)-a.get(0))/2);
        double h=u*u+Math.cos(la)*Math.cos(lb)*v*v;
        return 6371008.8*2*Math.asin(Math.sqrt(Math.min(1,h)));
    }
}
