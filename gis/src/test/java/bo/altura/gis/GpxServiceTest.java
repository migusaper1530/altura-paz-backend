package bo.altura.gis;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
import java.util.*;
class GpxServiceTest {
  GpxService service=new GpxService();
  String point(String lat,String lon,String elevation){return "<trkpt lat='"+lat+"' lon='"+lon+"'>"+(elevation==null?"":"<ele>"+elevation+"</ele>")+"</trkpt>";}
  String wrap(String body){return "<gpx xmlns='http://www.topografix.com/GPX/1/1' version='1.1'><trk><trkseg>"+body+"</trkseg></trk></gpx>";}
  String valid(){return point("-16.5","-68.1","3600")+point("-16.51","-68.1","3700")+point("-16.52","-68.1","3650");}
  @Test void computesGeodesicMetricsAndElevation(){var r=service.parse(wrap(valid()));assertEquals(100.0,r.get("ascent_m"));assertEquals(50.0,r.get("descent_m"));assertTrue((double)r.get("distance_m")>2200);assertEquals("gpx_unverified",r.get("elevation_source"));assertEquals(3,r.get("point_count"));assertNotNull(r.get("start"));assertNotNull(r.get("end"));}
  @Test void doesNotInventElevations(){var r=service.parse(wrap(point("-16.5","-68.1",null)+point("-16.51","-68.1","3700")));assertNull(r.get("ascent_m"));assertNull(r.get("descent_m"));assertEquals("unavailable",r.get("elevation_source"));}
  @Test void preservesSegmentsWithoutArtificialBridge(){String s="<trkseg>"+valid()+"</trkseg>";var a=service.parse(wrap(valid()));var b=service.parse("<gpx><trk>"+s+s+"</trk></gpx>");assertEquals((double)a.get("distance_m")*2,(double)b.get("distance_m"),0.1);assertEquals(6,b.get("point_count"));}
  @Test void acceptsRoutePointsAndGpx10(){String xml="<gpx xmlns='http://www.topografix.com/GPX/1/0'><rte>"+valid().replace("trkpt","rtept")+"</rte></gpx>";assertEquals(3,service.parse(xml).get("point_count"));}
  @Test void rejectsXxe(){assertThrows(IllegalArgumentException.class,()->service.parse("<!DOCTYPE gpx [<!ENTITY xxe SYSTEM 'file:///etc/passwd'>]><gpx>&xxe;</gpx>"));}
  @Test void rejectsInvalidDocument(){for(String s:Arrays.asList(null,"","<gpx", "<foo/>","<gpx xmlns='https://malicious.test'/>","<gpx/>",wrap(point("-16.5","-68.1",null)),"x".repeat(5*1024*1024+1)))assertThrows(IllegalArgumentException.class,()->service.parse(s));}
  @Test void rejectsInvalidCoordinates(){for(String lat:List.of("NaN","Infinity","91","-91","oops","0"))assertThrows(IllegalArgumentException.class,()->service.parse(wrap(point(lat,"-68.1",null)+valid())));for(String lon:List.of("NaN","181","-181","0"))assertThrows(IllegalArgumentException.class,()->service.parse(wrap(point("-16.5",lon,null)+valid())));}
  @Test void rejectsInvalidElevations(){for(String h:List.of("NaN","Infinity","-501","9001","oops"))assertThrows(IllegalArgumentException.class,()->service.parse(wrap(point("-16.5","-68.1",h)+valid())));}
  @Test void rejectsStationaryTrace(){String p=point("-16.5","-68.1","3600");assertThrows(IllegalArgumentException.class,()->service.parse(wrap(p+p)));}
  @Test void rejectsTooManyPoints(){String p=point("-16.5","-68.1",null);assertThrows(IllegalArgumentException.class,()->service.parse(wrap(p.repeat(100001))));}
  @Test void controllerExposesMetricsAndErrors(){var c=new GpxController(service);assertEquals("ok",c.health().get("status"));assertEquals(3,c.parse(wrap(valid())).get("point_count"));assertEquals(422,c.invalid(new IllegalArgumentException("test")).getStatusCode().value());}
}
